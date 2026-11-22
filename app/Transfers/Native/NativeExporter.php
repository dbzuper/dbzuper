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
            [$serverVersion, $objects, $routines, $events, $found] = $this->inspect($c, $t, $o, $objects);
            $command = NativeCommandBuilder::dump($c, $t, $o, $objects, $routines, $events);

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
            $exit = $process->run(
                function (string $chunk) use ($w, $p): void {
                    $w->write($chunk);
                    $p->advance(bytes: strlen($chunk));
                },
                fn () => $p->checkCancelled(),
            );

            if ($exit !== 0) {
                throw new NativeToolFailed($process->stderr() ?: "{$t->tool} exited with code {$exit}.", $exit);
            }
        } catch (Throwable $e) {
            $w->abort();

            throw $e;
        } finally {
            $command?->cleanup();
        }
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
     * @param  list<DumpObject>  $objects
     * @return array{0: string, 1: list<DumpObject>, 2: bool, 3: bool, 4: list<string>}
     */
    private function inspect(SavedConnection $c, ToolCheck $t, ExportOptions $o, array $objects): array
    {
        return $this->connections->using($c, function (Connection $db) use ($c, $t, $o, $objects): array {
            $version = (string) $db->selectOne($this->drivers->for($c->driver)->versionQuery())->version;
            $routines = $events = false;
            $gaps = [];

            if ($c->driver === DriverName::Postgres) {
                $gaps[] = self::PG_GAP;
                if ($o->tables !== null && (int) explode('.', (string) $t->version)[0] < 16) {
                    $objects = self::withPartitions($objects, $this->partitions($db));
                }
            } elseif ($o->tables === null && $o->structure) {
                // Routines and events come with "All" and structure only (spec §2).
                $access = MySqlPrivilegeProbe::check($db, (string) $c->database);
                ['routines' => $routines, 'events' => $events] = $access;
                $gaps = MySqlPrivilegeProbe::gaps($access);
            }

            return [$version, $objects, $routines, $events, $gaps];
        });
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
        if ($o->structure) {
            $parts[] = 'structure';
        }
        if ($o->data) {
            $parts[] = 'data';
        }
        if ($o->structure && $o->dropFirst) {
            $parts[] = 'drop before create';
        }
        $parts[] = $o->tables === null ? 'all tables' : count($o->tables).' chosen';
        $parts[] = $t->reason;

        return implode(', ', $parts);
    }
}
