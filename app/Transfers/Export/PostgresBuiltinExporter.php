<?php

namespace App\Transfers\Export;

use App\Enums\DriverName;
use App\Transfers\Io\DumpWriter;
use App\Transfers\TransferProgress;
use Illuminate\Database\Connection;
use PDO;
use PDOStatement;
use RuntimeException;
use Throwable;

/**
 * The PHP-generated PostgreSQL backup, used when pg_dump can't be (spec §2 "Built-in export"). Covers every
 * non-system schema; every name is schema-qualified and quoted.
 *
 * Order: session settings → optional drops → CREATE SCHEMA → enum types → sequences → tables (partitioned tables
 * with their partitions) → OWNED BY → data → NOT VALID constraints, indexes, foreign keys → setval → views.
 *
 * Everything is read in one REPEATABLE READ READ ONLY transaction whose SET LOCAL settings pin the text form of
 * every value (UTC, ISO dates, postgres intervals, exact floats) and an empty search_path, so the catalog functions
 * qualify every name. COMMIT ends the transaction and with it every setting, leaving the caller's session as it
 * was. The same settings head the file, so values read back exactly whatever the restoring session's defaults.
 * Rows stream through a NO SCROLL cursor, FETCH_ROWS at a time, so memory stays flat for any table size.
 */
final class PostgresBuiltinExporter implements BuiltinExporter
{
    /** Rows per FETCH, and so between progress reports and cancel checks. */
    private const FETCH_ROWS = 2000;

    private const CURSOR = 'dbzuper_rows';

    /**
     * Written at the top of the file: how the restoring session reads the values below. Not search_path: every name
     * in the file is qualified, and an empty search_path would outlast the restore in the restoring session.
     */
    private const RESTORE_SETTINGS = [
        "SET client_encoding = 'UTF8'",
        'SET standard_conforming_strings = on',
        'SET check_function_bodies = false',
        'SET xmloption = content',
        'SET client_min_messages = warning',
        "SET DateStyle = 'ISO, YMD'",
        "SET IntervalStyle = 'postgres'",
        "SET TimeZone = 'UTC'",
        'SET extra_float_digits = 3',
    ];

    /** Set (transaction-locally) while reading: the text form of every value, and qualified names in the DDL. */
    private const READ_SETTINGS = [
        // First, so no later statement runs into a server or role default: a big table takes as long as it takes.
        'statement_timeout' => '0',
        'lock_timeout' => '0',
        'idle_in_transaction_session_timeout' => '0',
        'client_encoding' => 'UTF8',
        'standard_conforming_strings' => 'on',
        'DateStyle' => 'ISO, YMD',
        'IntervalStyle' => 'postgres',
        'TimeZone' => 'UTC',
        'extra_float_digits' => '3',
        'bytea_output' => 'hex',
        'xmloption' => 'content',
        'search_path' => '',
        // A role under row-level security gets an error rather than a silently partial backup (as pg_dump).
        'row_security' => 'off',
    ];

    public function gaps(): array
    {
        return [
            'functions and procedures',
            'triggers',
            'extensions',
            'domains and composite types',
            'materialized views',
            'row-level security policies',
            'rules',
            'extended statistics',
            'foreign tables',
            'ownership and privileges',
            'other table settings (replica identity, CLUSTER ON, column storage and statistics targets)',
            'typed tables (restored as plain tables)',
        ];
    }

    public function export(Connection $db, ExportOptions $o, DumpWriter $w, TransferProgress $p): void
    {
        // Raw PDO from here on: Laravel would silently reconnect after a lost connection, onto a session without
        // the snapshot and settings below.
        $pdo = $db->getPdo();
        $pdo->exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try {
            $set = $pdo->prepare('SELECT pg_catalog.set_config(?, ?, true)');
            foreach (self::READ_SETTINGS as $name => $value) {
                $set->execute([$name, $value]);
            }
            $this->dump($db, $pdo, $o, $w, $p);
        } finally {
            try {
                // Ends the snapshot and drops the SET LOCAL settings (after an error, this rolls back).
                $pdo->exec('COMMIT');
            } catch (Throwable) {
                // The connection is released by the caller; a failure here must not hide the export's own error.
            }
        }
    }

    private function dump(Connection $db, PDO $pdo, ExportOptions $o, DumpWriter $w, TransferProgress $p): void
    {
        $all = $o->tables === null;
        $chosen = array_values(array_filter(
            ObjectLister::list($db, DriverName::Postgres),
            fn (DumpObject $obj) => $all || in_array($obj->key(), $o->tables, true),
        ));
        $views = array_values(array_filter($chosen, fn (DumpObject $obj) => $obj->kind === 'view'));
        $relations = PostgresDdl::relations($db, array_values(array_filter($chosen, fn (DumpObject $obj) => $obj->kind === 'table')));
        $byOid = array_column($relations, null, 'oid');
        $sequences = PostgresDdl::sequences($db, $relations, $all);
        $version = PostgresDdl::serverVersion($db);

        $w->write(implode(";\n", self::RESTORE_SETTINGS).";\n\n");
        $viewSql = [];

        if ($o->structure) {
            $enums = PostgresDdl::enumTypes($db, $relations, $all);
            $viewSql = PostgresDdl::views($db, $views);

            if ($o->dropFirst) {
                foreach ($views as $view) {
                    $w->write('DROP VIEW IF EXISTS '.self::name($view).' CASCADE;'."\n");
                }
                foreach ($relations as $rel) {
                    if ($rel['top']) {
                        $w->write('DROP TABLE IF EXISTS '.PostgresDdl::qualified($rel['schema'], $rel['name']).' CASCADE;'."\n");
                    }
                }
                foreach ($sequences as $s) {
                    // Owned ones went with their table; one merely used by a chosen table may serve others too.
                    if ($s['owner'] === null && ! $s['ifNotExists']) {
                        $w->write('DROP SEQUENCE IF EXISTS '.PostgresDdl::qualified($s['schema'], $s['name']).";\n");
                    }
                }
                if ($all) {
                    foreach ($enums as $enum) {
                        $w->write('DROP TYPE IF EXISTS '.PostgresDdl::qualified($enum['schema'], $enum['name']).";\n");
                    }
                }
                $w->write("\n");
            }

            $schemas = [
                ...array_column($relations, 'schema'), ...array_column($sequences, 'schema'), ...array_column($enums, 'schema'),
                ...array_map(fn (DumpObject $v) => (string) $v->schema, $views),
            ];
            self::statements($w, PostgresDdl::schemas($db, $schemas, $all));

            foreach ($enums as $enum) {
                $create = PostgresDdl::createEnum($enum);
                // A backup of some tables meets a target that may already have the type (used by other tables).
                $w->write(($all ? $create : self::unlessExists($create)).";\n");
                if ($enum['comment'] !== null) {
                    $w->write('COMMENT ON TYPE '.PostgresDdl::qualified($enum['schema'], $enum['name']).' IS '.Literals::postgres($enum['comment'], false).";\n");
                }
            }
            foreach ($sequences as $s) {
                $w->write(PostgresDdl::createSequence($s).";\n");
                if ($s['comment'] !== null) {
                    $w->write('COMMENT ON SEQUENCE '.PostgresDdl::qualified($s['schema'], $s['name']).' IS '.Literals::postgres($s['comment'], false).";\n");
                }
            }
            $w->write("\n");

            foreach ($relations as $rel) {
                $p->checkCancelled();
                $w->write(PostgresDdl::createTable($db, $rel, $byOid, $version).";\n");
                self::statements($w, PostgresDdl::partitionDefaults($db, $rel), blank: false);
                self::statements($w, PostgresDdl::comments($db, $rel));
            }
            self::statements($w, PostgresDdl::ownedBy($sequences, $relations));
        }

        if ($o->data) {
            foreach ($relations as $rel) {
                // A partitioned table's rows are read (and restored) once, through the top table.
                if ($rel['top']) {
                    $p->checkCancelled();
                    $this->data($db, $pdo, $rel, $w, $p);
                }
            }
            $w->write("\n");
        }

        if ($o->structure) {
            foreach ($relations as $rel) {
                $p->checkCancelled();
                self::statements($w, PostgresDdl::postDataConstraints($db, $rel, false), blank: false);
                self::statements($w, PostgresDdl::indexes($db, $rel), blank: false);
            }
            foreach ($relations as $rel) {
                self::statements($w, PostgresDdl::foreignKeys($db, $rel), blank: false);
                self::statements($w, PostgresDdl::keyComments($db, $rel), blank: false);
            }
            $w->write("\n");
        }

        if ($o->data) {
            self::statements($w, PostgresDdl::setvals($db, $sequences, $relations));
        }

        if ($o->structure) {
            self::statements($w, $viewSql);
        }
    }

    /** @param array{oid: int, schema: string, name: string, kind: string} $rel */
    private function data(Connection $db, PDO $pdo, array $rel, DumpWriter $w, TransferProgress $p): void
    {
        $table = PostgresDdl::qualified($rel['schema'], $rel['name']);
        $label = $rel['schema'].'.'.$rel['name'];
        // Generated columns are the server's to fill.
        $columns = array_values(array_filter(PostgresDdl::columns($db, $rel['oid']), fn (array $c) => $c['generated'] === ''));

        // Every value as its text form (fixed by READ_SETTINGS), which the column's input function reads back
        // exactly; bytea as bytes, written as hex; money (lc_monetary-dependent text) through numeric.
        $select = array_map(fn (array $c) => match (true) {
            $c['is_bytea'] => PostgresDdl::quote($c['name']),
            $c['read_as'] !== null => PostgresDdl::quote($c['name']).'::'.$c['read_as'].'::pg_catalog.text',
            default => PostgresDdl::quote($c['name']).'::pg_catalog.text',
        }, $columns);
        $overriding = array_filter($columns, fn (array $c) => $c['identity'] === 'a') !== [];
        $batcher = new InsertBatcher($w, $columns === []
            ? 'INSERT INTO '.$table.' DEFAULT VALUES'
            : 'INSERT INTO '.$table.' ('.implode(', ', array_map(fn (array $c) => PostgresDdl::quote($c['name']), $columns)).')'
                .($overriding ? ' OVERRIDING SYSTEM VALUE' : '').' VALUES');

        // ONLY: an inheritance parent's rows, not its children's (they are read from the children). A partitioned
        // table has no rows of its own, so it is read whole.
        $pdo->exec('DECLARE '.self::CURSOR.' NO SCROLL CURSOR FOR SELECT '.($select === [] ? '1' : implode(', ', $select))
            .' FROM '.($rel['kind'] === 'p' ? '' : 'ONLY ').$table);
        $bytes = $w->bytesWritten();
        while (true) {
            $rows = self::query($pdo, 'FETCH '.self::FETCH_ROWS.' FROM '.self::CURSOR)->fetchAll(PDO::FETCH_NUM);
            if ($rows === []) {
                break;
            }
            foreach ($rows as $row) {
                if ($columns === []) {
                    // A table without columns: one DEFAULT VALUES statement per row.
                    $batcher->flush();
                    $w->write('INSERT INTO '.$table." DEFAULT VALUES;\n");

                    continue;
                }
                $values = [];
                foreach ($row as $i => $value) {
                    $c = $columns[$i];
                    $literal = Literals::postgres($value, $c['is_bytea']);
                    $values[] = $value !== null && $c['read_as'] !== null ? $literal.'::'.$c['read_as'] : $literal;
                }
                $batcher->add('('.implode(',', $values).')');
            }
            $p->advance(bytes: $w->bytesWritten() - $bytes, rows: count($rows), table: $label);
            $bytes = $w->bytesWritten();
            unset($rows);
            $p->checkCancelled();
        }
        $pdo->exec('CLOSE '.self::CURSOR);

        $batcher->flush();
        $p->advance(bytes: $w->bytesWritten() - $bytes, table: $label);
    }

    /** @param list<string> $statements */
    private static function statements(DumpWriter $w, array $statements, bool $blank = true): void
    {
        foreach ($statements as $sql) {
            $w->write($sql.";\n");
        }
        if ($blank && $statements !== []) {
            $w->write("\n");
        }
    }

    /** Runs a CREATE TYPE unless the type exists already. */
    private static function unlessExists(string $create): string
    {
        $tag = '$dbzuper$';
        for ($n = 1; str_contains($create, $tag); $n++) {
            $tag = '$dbzuper'.$n.'$';
        }

        return "DO {$tag}BEGIN {$create}; EXCEPTION WHEN duplicate_object THEN NULL; END{$tag}";
    }

    private static function name(DumpObject $obj): string
    {
        return PostgresDdl::qualified((string) $obj->schema, $obj->name);
    }

    /** The connection throws on errors (PDO::ERRMODE_EXCEPTION); this also covers one that doesn't. */
    private static function query(PDO $pdo, string $sql): PDOStatement
    {
        $stmt = $pdo->query($sql);
        if ($stmt === false) {
            throw new RuntimeException('Query failed: '.mb_strimwidth($sql, 0, 100));
        }

        return $stmt;
    }
}
