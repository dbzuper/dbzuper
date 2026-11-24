<?php

namespace App\Transfers\Native;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Transfers\Export\DumpHeader;
use App\Transfers\Export\DumpObject;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Io\DumpWriter;
use App\Transfers\TransferCancelled;
use App\Transfers\TransferProgress;
use Illuminate\Database\Connection;
use Throwable;

/**
 * A backup made by mysqldump / mariadb-dump / pg_dump (spec §2 "Native export"): the DBZuper header first, then the
 * tool's stdout streamed into the writer as it comes. On failure or cancel the tool is killed and the writer
 * aborted, so no partial file is left; on success the caller closes the writer.
 *
 * Before the tool runs, one short connection reads the server version for the header and, where needed, whether
 * the login can read routines and events (MySQL/MariaDB "All" exports) and which partitions belong to chosen
 * partitioned tables (pg_dump < 16, whose -t matches a partitioned parent without its partitions or rows).
 */
final class NativeExporter
{
    /** Left out by --no-owner --no-privileges on purpose; a restore elsewhere must not need the same roles. */
    public const PG_GAP = 'ownership and privileges';

    public const ENDED_EARLY = "The backup tool's output ended early; nothing was saved.";

    /** The end of the dump kept to look for the tool's closing comment. */
    private const TAIL_BYTES = 8_192;

    /** mysqldump / mariadb-dump print single-precision FLOAT values with 6 significant digits (Ruling 22). */
    public const FLOAT_GAP = 'FLOAT columns rounded to 6 significant digits (mysqldump limit; use built-in for exact values)';

    public function __construct(
        private readonly ConnectionFactory $connections,
        private readonly DriverRegistry $drivers,
    ) {}

    /**
     * @param  list<DumpObject>  $objects  the chosen objects (used when $o->tables is not null)
     * @param  list<string>  $gaps  what the header lists as not included, besides what is found here
     *
     * @throws NativeToolFailed
     * @throws TransferCancelled
     */
    public function run(SavedConnection $c, ToolCheck $t, ExportOptions $o, array $objects, DumpWriter $w, TransferProgress $p, array $gaps): void
    {
        $command = null;

        try {
            [$serverVersion, $objects, $routines, $events, $found, $o, $unchosen] = $this->inspect($c, $t, $o, $objects);
            // Windows: the tool writes its own file next to the output (the transfer's storage directory), tailed
            // from there; see NativeProcess. Elsewhere stdout is a pipe.
            $outputFile = PHP_OS_FAMILY === 'Windows'
                ? dirname($w->path()).DIRECTORY_SEPARATOR.'.dbz-native-'.bin2hex(random_bytes(8)).'.sql'
                : null;
            $command = NativeCommandBuilder::dump($c, $t, $o, $objects, $routines, $events, $outputFile, $unchosen);

            $w->write(DumpHeader::render([
                'app_version' => (string) (config('dbzuper.version') ?? 'dev'),
                'engine' => $c->driver->value,
                'server_version' => $serverVersion,
                'database' => (string) $c->database,
                'date' => now('UTC')->format('Y-m-d H:i:s').' UTC',
                'method' => 'native',
                'options' => $this->describe($t, $o),
                'gaps' => array_values(array_unique([...$gaps, ...$found])),
            ]));
            $w->write("\n");

            $process = new NativeProcess($command, $c->password !== null ? (string) $c->password : null);
            $tail = '';
            $exit = $process->run(
                function (string $chunk) use ($w, $p, &$tail): void {
                    $w->write($chunk);
                    $p->advance(bytes: strlen($chunk));
                    $tail = substr($tail.$chunk, -self::TAIL_BYTES);
                },
                fn () => $p->checkCancelled(),
                outputFile: $outputFile,
            );

            if ($exit !== 0) {
                throw new NativeToolFailed($process->stderr() ?: "{$t->tool} exited with code {$exit}.", $exit);
            }
            // A dump cut short on the way still exits 0; only the tool's closing comment proves it all arrived.
            if (! self::hasTrailer((string) $t->tool, $tail)) {
                throw new NativeToolFailed(self::ENDED_EARLY, $exit);
            }
        } catch (Throwable $e) {
            $w->abort();

            throw $e;
        } finally {
            $command?->cleanup();
        }
    }

    /**
     * Does the end of the dump hold the tool's closing comment? pg_dump writes "-- PostgreSQL database dump
     * complete" (pg_dump 18 adds an \unrestrict line after it); mysqldump and mariadb-dump write "-- Dump completed"
     * (with " on <date>" unless --skip-dump-date). The builder never turns comments off.
     */
    public static function hasTrailer(string $tool, string $tail): bool
    {
        return str_contains($tail, $tool === 'pg_dump' ? '-- PostgreSQL database dump complete' : '-- Dump completed');
    }

    /**
     * Partitioned tables in $objects followed by all their partitions (sub-partitions too), without duplicates.
     *
     * @param  list<DumpObject>  $objects
     * @param  array<string, list<DumpObject>>  $partitionsOf  DumpObject::key() of a parent => its direct partitions
     * @return list<DumpObject>
     */
    public static function withPartitions(array $objects, array $partitionsOf): array
    {
        $seen = [];
        $out = [];
        foreach ($objects as $object) {
            if (! isset($seen[$object->key()])) {
                $seen[$object->key()] = true;
                $out[] = $object;
            }
        }

        // Breadth-first over the growing list, so partitions of partitions are found too.
        for ($i = 0; $i < count($out); $i++) {
            foreach ($partitionsOf[$out[$i]->key()] ?? [] as $partition) {
                if (! isset($seen[$partition->key()])) {
                    $seen[$partition->key()] = true;
                    $out[] = $partition;
                }
            }
        }

        return $out;
    }

    /**
     * Gives every partition the mode of its (root) parent, so a structure-only parent's partitions lose their rows too.
     *
     * @param  array<string, list<DumpObject>>  $partitionsOf  every partition by its parent's key
     */
    public static function withPartitionModes(ExportOptions $o, array $partitionsOf): ExportOptions
    {
        if (! $o->isMixed()) {
            return $o;
        }

        $modes = $o->modes;
        $queue = array_keys($modes);
        for ($i = 0; $i < count($queue); $i++) {
            foreach ($partitionsOf[$queue[$i]] ?? [] as $partition) {
                if (! isset($modes[$partition->key()])) {
                    $modes[$partition->key()] = $modes[$queue[$i]];
                    $queue[] = $partition->key();
                }
            }
        }

        return new ExportOptions($o->tables, $o->structure, $o->data, $o->dropFirst, $o->gzip, $modes);
    }

    /**
     * @param  list<DumpObject>  $objects
     * @return array{0: string, 1: list<DumpObject>, 2: bool, 3: bool, 4: list<string>, 5: ExportOptions, 6: list<string>}
     */
    private function inspect(SavedConnection $c, ToolCheck $t, ExportOptions $o, array $objects): array
    {
        return $this->connections->using($c, function (Connection $db) use ($c, $t, $o, $objects): array {
            $version = (string) $db->selectOne($this->drivers->for($c->driver)->versionQuery())->version;
            $routines = $events = false;
            $gaps = [];
            $unchosen = [];

            if ($c->driver === DriverName::Postgres) {
                $gaps[] = self::PG_GAP;
                if ($o->tables !== null && (int) explode('.', (string) $t->version)[0] < 16) {
                    $partitions = $this->partitions($db);
                    $objects = self::withPartitions($objects, $partitions);
                    $o = self::withPartitionModes($o, $partitions);
                }
            } else {
                if ($c->driver === DriverName::MariaDb && $o->isMixed() && $o->tables !== null) {
                    $chosen = array_map(fn (DumpObject $object) => $object->name, $objects);
                    $all = array_map(fn ($r) => (string) $r->n, $db->select('SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()'));
                    $unchosen = array_values(array_diff($all, $chosen));
                }
                if ($o->tables === null && $o->anyStructure()) {
                    // Routines and events come with "All" and structure only (spec §2).
                    $access = MySqlPrivilegeProbe::check($db, (string) $c->database);
                    ['routines' => $routines, 'events' => $events] = $access;
                    $gaps = MySqlPrivilegeProbe::gaps($access);
                }
                if ($o->anyData() && $this->hasFloatColumns($db, (string) $c->database, $o->tables)) {
                    $gaps[] = self::FLOAT_GAP;
                }
            }

            return [$version, $objects, $routines, $events, $gaps, $o, $unchosen];
        });
    }

    /**
     * What a native export of these tables (null: all, with structure and data) would leave out, for the dialog
     * before the user starts. The same entries the dump header lists.
     *
     * @param  list<string>|null  $chosenKeys  DumpObject::key() values; null = every table and view
     * @return list<string>
     */
    public function gapsFor(SavedConnection $c, ?array $chosenKeys): array
    {
        if ($c->driver === DriverName::Postgres) {
            return [self::PG_GAP];
        }
        if ($c->driver === DriverName::Sqlite) {
            return [];
        }

        return $this->connections->using($c, function (Connection $db) use ($c, $chosenKeys): array {
            $gaps = $chosenKeys === null ? MySqlPrivilegeProbe::gaps(MySqlPrivilegeProbe::check($db, (string) $c->database)) : [];
            if ($this->hasFloatColumns($db, (string) $c->database, $chosenKeys)) {
                $gaps[] = self::FLOAT_GAP;
            }

            return $gaps;
        });
    }

    /** @param list<string>|null $tables MySQL keys are the bare table names; null = all */
    private function hasFloatColumns(Connection $db, string $database, ?array $tables): bool
    {
        if ($tables === []) {
            return false;
        }
        $sql = "SELECT COUNT(*) AS n FROM information_schema.COLUMNS c
                JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
                WHERE c.TABLE_SCHEMA = ? AND c.DATA_TYPE = 'float' AND t.TABLE_TYPE <> 'VIEW'";
        $bindings = [$database];
        if ($tables !== null) {
            $sql .= ' AND c.TABLE_NAME IN ('.implode(', ', array_fill(0, count($tables), '?')).')';
            array_push($bindings, ...$tables);
        }

        return (int) $db->selectOne($sql, $bindings)->n > 0;
    }

    /** @return array<string, list<DumpObject>> every partition in the database, by its parent's key */
    private function partitions(Connection $db): array
    {
        $rows = $db->select(
            'SELECT pn.nspname AS parent_schema, p.relname AS parent_name, cn.nspname AS child_schema, c.relname AS child_name
             FROM pg_catalog.pg_inherits i
             JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid AND c.relispartition
             JOIN pg_catalog.pg_namespace cn ON cn.oid = c.relnamespace
             JOIN pg_catalog.pg_class p ON p.oid = i.inhparent
             JOIN pg_catalog.pg_namespace pn ON pn.oid = p.relnamespace
             ORDER BY cn.nspname, c.relname',
        );

        $map = [];
        foreach ($rows as $row) {
            $parent = new DumpObject((string) $row->parent_schema, (string) $row->parent_name, 'table');
            $map[$parent->key()][] = new DumpObject((string) $row->child_schema, (string) $row->child_name, 'table');
        }

        return $map;
    }

    private function describe(ToolCheck $t, ExportOptions $o): string
    {
        $parts = [];
        if ($o->isMixed()) {
            $parts[] = 'structure and data per table';
        } else {
            if ($o->structure) {
                $parts[] = 'structure';
            }
            if ($o->data) {
                $parts[] = 'data';
            }
        }
        if ($o->anyStructure() && $o->dropFirst) {
            $parts[] = 'drop before create';
        }
        $parts[] = $o->tables === null ? 'all tables' : count($o->tables).' chosen';
        $parts[] = $t->reason;

        return implode(', ', $parts);
    }
}
