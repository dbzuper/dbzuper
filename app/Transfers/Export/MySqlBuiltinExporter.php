<?php

namespace App\Transfers\Export;

use App\Enums\DriverName;
use App\Transfers\Io\DumpWriter;
use App\Transfers\TransferProgress;
use Illuminate\Database\Connection;
use PDO;
use Pdo\Mysql;
use PDOStatement;
use RuntimeException;
use Throwable;
use UnexpectedValueException;

/**
 * The PHP-generated MySQL/MariaDB backup, used when mysqldump/mariadb-dump can't be (spec §2 "Built-in export").
 *
 * Order: session header → optional drops → CREATE TABLE (SHOW CREATE TABLE) → data → views (dependency order) →
 * triggers (after the data, so an INSERT trigger doesn't run a second time on restore) → footer. Everything is
 * read in one consistent snapshot, on a session pinned to time_zone +00:00 and an empty sql_mode, so neither the
 * server's nor the caller's session settings change what is written. Values are written with backslash escapes;
 * the header's SQL_MODE therefore never includes NO_BACKSLASH_ESCAPES.
 */
final class MySqlBuiltinExporter implements BuiltinExporter
{
    /** The restoring session's mode: permissive (zero dates) and keeps explicit id 0 in AUTO_INCREMENT columns. */
    private const RESTORE_SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';

    /** Rows between progress reports and cancel checks. */
    private const BATCH_ROWS = 1000;

    /** Written as hex literals (BIT is handled separately, as a number). */
    private const BINARY_TYPES = [
        'binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob',
        'geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon',
        'geometrycollection', 'geomcollection',
    ];

    /**
     * Columns the server fills itself and that an INSERT must not name: generated columns (MySQL's
     * DEFAULT_GENERATED is a plain column with an expression default, so it doesn't match) and MariaDB's
     * system-versioning period columns.
     */
    private const SERVER_FILLED = '/\b(?:VIRTUAL|STORED|PERSISTENT)\s+GENERATED\b|\bROW\s+(?:START|END)\b/i';

    private const DEFINER = '/^(CREATE\s+(?:OR\s+REPLACE\s+)?(?:ALGORITHM\s*=\s*\w+\s+)?)DEFINER\s*=\s*(?:`(?:[^`]|``)*`|\'(?:[^\'\\\\]|\\\\.)*\'|[^\s@`\']+)(?:\s*@\s*(?:`(?:[^`]|``)*`|\'(?:[^\'\\\\]|\\\\.)*\'|[^\s`\']+))?\s+/i';

    public function gaps(): array
    {
        return [
            'stored procedures and functions',
            'events',
            'sequences (MariaDB)',
            'system-versioned history (MariaDB, current rows only)',
        ];
    }

    public function export(Connection $db, ExportOptions $o, DumpWriter $w, TransferProgress $p): void
    {
        $chosen = array_values(array_filter(
            ObjectLister::list($db, DriverName::MySql),
            fn (DumpObject $obj) => $o->tables === null || in_array($obj->key(), $o->tables, true),
        ));
        $tables = array_values(array_map(fn (DumpObject $t) => $t->name, array_filter($chosen, fn ($obj) => $obj->kind === 'table')));
        $views = array_values(array_map(fn (DumpObject $v) => $v->name, array_filter($chosen, fn ($obj) => $obj->kind === 'view')));

        // Raw PDO from here on: Laravel would silently reconnect after a lost connection, onto a session without
        // the snapshot, time zone and sql_mode below.
        $pdo = $db->getPdo();
        $previous = self::query($pdo, 'SELECT @@SESSION.time_zone, @@SESSION.sql_mode')->fetch(PDO::FETCH_NUM);
        $pdo->exec("SET NAMES utf8mb4, SESSION time_zone = '+00:00', SESSION sql_mode = '', SESSION sql_quote_show_create = 1");
        $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $pdo->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT');

        try {
            $this->dump($pdo, $o, $tables, $views, $w, $p);
        } finally {
            try {
                $pdo->exec('COMMIT');
                if (is_array($previous)) {
                    $pdo->prepare('SET SESSION time_zone = ?, SESSION sql_mode = ?')->execute($previous);
                }
            } catch (Throwable) {
                // The connection is released by the caller; a failure here must not hide the export's own error.
            }
        }
    }

    /**
     * @param  list<string>  $tables
     * @param  list<string>  $views
     */
    private function dump(PDO $pdo, ExportOptions $o, array $tables, array $views, DumpWriter $w, TransferProgress $p): void
    {
        $w->write("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\n"
            ."SET SQL_MODE='".self::RESTORE_SQL_MODE."';\nSET TIME_ZONE='+00:00';\n\n");

        if ($o->structure) {
            if ($o->dropFirst) {
                foreach ($views as $view) {
                    $w->write('DROP VIEW IF EXISTS '.self::quote($view).";\n");
                }
                foreach ($tables as $table) {
                    $w->write('DROP TABLE IF EXISTS '.self::quote($table).";\n");
                }
                $w->write("\n");
            }

            foreach ($tables as $table) {
                $p->checkCancelled();
                $w->write(self::showCreate($pdo, 'TABLE', $table).";\n\n");
            }
        }

        if ($o->data) {
            $columns = $this->columns($pdo);
            foreach ($tables as $table) {
                $p->checkCancelled();
                $this->data($pdo, $table, $columns[$table] ?? [], $w, $p);
            }
            $w->write("\n");
        }

        if ($o->structure) {
            foreach ($this->viewsInOrder($pdo, $views) as $create) {
                $w->write($create.";\n\n");
            }
            $this->triggers($pdo, $tables, $w);
        }

        $w->write("SET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n");
    }

    /**
     * Insertable columns per table, in table order, with how each value is read and written.
     *
     * @return array<string, list<array{name: string, kind: 'plain'|'binary'|'bit'|'float'}>>
     */
    private function columns(PDO $pdo): array
    {
        $columns = [];
        $rows = self::query($pdo, 'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, EXTRA FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION')->fetchAll(PDO::FETCH_NUM);
        foreach ($rows as [$table, $name, $type, $extra]) {
            if (preg_match(self::SERVER_FILLED, (string) $extra) === 1) {
                continue;
            }
            $type = strtolower((string) $type);
            $columns[(string) $table][] = [
                'name' => (string) $name,
                'kind' => match (true) {
                    in_array($type, self::BINARY_TYPES, true) => 'binary',
                    $type === 'bit' => 'bit',
                    $type === 'float' => 'float',
                    default => 'plain',
                },
            ];
        }

        return $columns;
    }

    /** @param list<array{name: string, kind: 'plain'|'binary'|'bit'|'float'}> $columns */
    private function data(PDO $pdo, string $table, array $columns, DumpWriter $w, TransferProgress $p): void
    {
        if ($columns === []) {
            return;
        }

        $select = array_map(fn (array $c) => match ($c['kind']) {
            // mysqlnd hands FLOAT to PHP rounded to ~6 significant digits; widened to DOUBLE on the server it is
            // exact, and the shortest double literal converts back to the very same single-precision value.
            'float' => self::quote($c['name']).' + 0e0',
            // As a number: mysqlnd returns BIT as an integer (or a decimal string past PHP_INT_MAX).
            'bit' => 'CAST('.self::quote($c['name']).' AS UNSIGNED)',
            default => self::quote($c['name']),
        }, $columns);
        $kinds = array_column($columns, 'kind');
        $batcher = new InsertBatcher(
            $w,
            'INSERT INTO '.self::quote($table).' ('.implode(', ', array_map(fn ($c) => self::quote($c['name']), $columns)).') VALUES',
        );

        $bytes = $w->bytesWritten();
        $pending = 0;
        // Unbuffered: rows stream from the server as they are read, so memory stays flat for any table size.
        $buffered = $pdo->getAttribute(Mysql::ATTR_USE_BUFFERED_QUERY);
        $pdo->setAttribute(Mysql::ATTR_USE_BUFFERED_QUERY, false);
        try {
            $stmt = self::query($pdo, 'SELECT '.implode(', ', $select).' FROM '.self::quote($table));
            while (($row = $stmt->fetch(PDO::FETCH_NUM)) !== false) {
                $values = [];
                foreach ($row as $i => $value) {
                    $values[] = $kinds[$i] === 'bit' ? self::bit($value) : Literals::mysql($value, $kinds[$i] === 'binary');
                }
                $batcher->add('('.implode(',', $values).')');

                if (++$pending === self::BATCH_ROWS) {
                    $p->advance(bytes: $w->bytesWritten() - $bytes, rows: $pending, table: $table);
                    $bytes = $w->bytesWritten();
                    $pending = 0;
                    $p->checkCancelled();
                }
            }
            $stmt->closeCursor();
        } finally {
            // After an error or a cancel, freeing the statement makes mysqlnd read what is left of the result, so
            // the connection can run the next statement either way.
            unset($stmt);
            $pdo->setAttribute(Mysql::ATTR_USE_BUFFERED_QUERY, $buffered);
        }

        $batcher->flush();
        $p->advance(bytes: $w->bytesWritten() - $bytes, rows: $pending, table: $table);
    }

    /**
     * CREATE VIEW statements without DEFINER, each after the views it selects from.
     *
     * @param  list<string>  $views
     * @return list<string>
     */
    private function viewsInOrder(PDO $pdo, array $views): array
    {
        $creates = [];
        foreach ($views as $view) {
            $creates[$view] = self::withoutDefiner(self::showCreate($pdo, 'VIEW', $view));
        }

        // SHOW CREATE VIEW names every table and view it reads as `name`, so a view depends on each other chosen
        // view whose quoted name appears in its text. A false match (a column alias spelled like a view) only
        // reorders; a cycle (impossible for real views) falls back to name order.
        $ordered = [];
        $state = [];
        $visit = function (string $view) use (&$visit, &$ordered, &$state, $creates, $views): void {
            if (isset($state[$view])) {
                return;
            }
            $state[$view] = 'visiting';
            foreach ($views as $other) {
                if ($other !== $view && str_contains($creates[$view], self::quote($other))) {
                    $visit($other);
                }
            }
            $ordered[] = $creates[$view];
        };
        foreach ($views as $view) {
            $visit($view);
        }

        return $ordered;
    }

    /**
     * The chosen tables' triggers in creation order (which fixes their ACTION_ORDER), each under its own
     * sql_mode and inside a DELIMITER block, without DEFINER.
     *
     * @param  list<string>  $tables
     */
    private function triggers(PDO $pdo, array $tables, DumpWriter $w): void
    {
        $rows = self::query($pdo, 'SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ACTION_TIMING, ACTION_ORDER')
            ->fetchAll(PDO::FETCH_NUM);
        $chosen = array_flip($tables);

        $any = false;
        foreach ($rows as [$name, $table]) {
            if (! isset($chosen[(string) $table])) {
                continue;
            }
            $show = self::query($pdo, 'SHOW CREATE TRIGGER '.self::quote((string) $name))->fetch(PDO::FETCH_NUM);
            if (! is_array($show) || ! isset($show[1], $show[2])) {
                throw new RuntimeException("SHOW CREATE TRIGGER returned nothing for {$name}");
            }
            $mode = (string) $show[1];
            $create = self::withoutDefiner((string) $show[2]);

            $delimiter = ';;';
            for ($n = 2; str_contains($create, $delimiter); $n++) {
                $delimiter = str_repeat('$', $n);
            }

            // The body is stored as written and runs under the mode it was created with. NO_AUTO_CREATE_USER means
            // nothing to a trigger and MySQL 8 rejects it, so a MariaDB or MySQL 5.7 dump would not restore there.
            $mode = implode(',', array_diff(explode(',', $mode), ['NO_AUTO_CREATE_USER']));
            if (preg_match('/^[A-Z0-9_,]*$/', $mode) === 1) {
                $w->write("SET SESSION SQL_MODE='{$mode}';\n");
            }
            $w->write("DELIMITER {$delimiter}\n{$create}{$delimiter}\nDELIMITER ;\n\n");
            $any = true;
        }

        if ($any) {
            $w->write("SET SESSION SQL_MODE='".self::RESTORE_SQL_MODE."';\n\n");
        }
    }

    private static function showCreate(PDO $pdo, string $kind, string $name): string
    {
        $row = self::query($pdo, "SHOW CREATE {$kind} ".self::quote($name))->fetch(PDO::FETCH_NUM);
        if (! is_array($row) || ! isset($row[1])) {
            throw new RuntimeException("SHOW CREATE {$kind} returned nothing for {$name}");
        }

        return (string) $row[1];
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

    private static function withoutDefiner(string $create): string
    {
        return (string) preg_replace(self::DEFINER, '$1', $create, 1);
    }

    /** A BIT value read as CAST(... AS UNSIGNED): written as a bare number, which BIT stores bit for bit. */
    private static function bit(mixed $value): string
    {
        if ($value === null) {
            return 'NULL';
        }
        $digits = (string) $value;
        if (! ctype_digit($digits)) {
            throw new UnexpectedValueException('Unexpected BIT value');
        }

        return $digits;
    }

    private static function quote(string $name): string
    {
        return '`'.str_replace('`', '``', $name).'`';
    }
}
