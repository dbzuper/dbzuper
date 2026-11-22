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
use UnexpectedValueException;

/**
 * The SQLite backup (SQLite always uses the built-in method, so this is its only export path).
 *
 * Order: PRAGMA foreign_keys=OFF; BEGIN TRANSACTION; → optional drops → CREATE TABLE → data → sqlite_sequence
 * positions → indexes → views (each after the views it reads) → triggers (after the data, so an INSERT trigger
 * doesn't run a second time) → COMMIT; — the file loads in the sqlite3 CLI as is, and the restorer drops the
 * transaction lines. DDL is sqlite_master.sql verbatim; everything is read inside one read transaction.
 *
 * SQLite is dynamically typed, so each value is written by its own typeof(), not by the column's declared type:
 * an integer in a TEXT column stays an integer, a blob in an INTEGER column stays a blob. A rowid that no INTEGER
 * PRIMARY KEY aliases is written too, so rowids survive. Generated columns are left to SQLite.
 */
final class SqliteBuiltinExporter implements BuiltinExporter
{
    /** Rows between progress reports and cancel checks. */
    private const BATCH_ROWS = 1000;

    /** Names that reach the rowid unless a column has taken them. */
    private const ROWID_NAMES = ['rowid', '_rowid_', 'oid'];

    /** 2^62: exact as an integer literal and as a double, so multiplying or dividing by it never rounds. */
    private const POW2_62 = 4611686018427387904;

    /** Parses text the way SQLite parses a REAL literal (both go through sqlite3AtoF). */
    private ?PDOStatement $parse = null;

    public function gaps(): array
    {
        return [];
    }

    public function export(Connection $db, ExportOptions $o, DumpWriter $w, TransferProgress $p): void
    {
        $chosen = [];
        foreach (ObjectLister::list($db, DriverName::Sqlite) as $obj) {
            if ($o->tables === null || in_array($obj->key(), $o->tables, true)) {
                $chosen[$obj->name] = true;
            }
        }

        // Raw PDO from here on, with values fetched as their own PHP types (int, float, string) whatever the
        // connection was configured with: a stringified REAL would lose digits.
        $pdo = $db->getPdo();
        $stringify = $pdo->getAttribute(PDO::ATTR_STRINGIFY_FETCHES);
        $pdo->setAttribute(PDO::ATTR_STRINGIFY_FETCHES, false);
        $ownTransaction = ! $pdo->inTransaction();
        if ($ownTransaction) {
            // Deferred: the read lock (or WAL snapshot) is taken by the first SELECT and held to the COMMIT.
            $pdo->exec('BEGIN');
        }

        try {
            $this->parse = $pdo->prepare('SELECT CAST(? AS REAL)');
            $this->dump($pdo, $o, $chosen, $w, $p);
        } finally {
            $this->parse = null;
            try {
                if ($ownTransaction) {
                    $pdo->exec('COMMIT');
                }
                $pdo->setAttribute(PDO::ATTR_STRINGIFY_FETCHES, $stringify);
            } catch (Throwable) {
                // The connection is released by the caller; a failure here must not hide the export's own error.
            }
        }
    }

    /** @param array<string, true> $chosen */
    private function dump(PDO $pdo, ExportOptions $o, array $chosen, DumpWriter $w, TransferProgress $p): void
    {
        $kinds = [];
        foreach (self::query($pdo, "SELECT name, type, wr FROM pragma_table_list WHERE schema = 'main'")->fetchAll(PDO::FETCH_NUM) as [$name, $type, $wr]) {
            $kinds[(string) $name] = ['type' => (string) $type, 'without_rowid' => (int) $wr === 1];
        }

        $tables = [];
        $views = [];
        $indexes = [];
        $triggers = [];
        $master = self::query($pdo, 'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid')->fetchAll(PDO::FETCH_NUM);
        foreach ($master as [$type, $name, $table, $sql]) {
            [$name, $table] = [(string) $name, (string) $table];
            if ($sql === null || ! isset($chosen[$table])) {
                continue; // automatic indexes have no SQL; sqlite_* internals are never chosen
            }
            $sql = (string) $sql;
            if ($type === 'table' && ($kinds[$name]['type'] ?? 'table') !== 'shadow') {
                $tables[$name] = $sql; // a shadow table belongs to a virtual table, which creates it itself
            } elseif ($type === 'view') {
                $views[$name] = $sql;
            } elseif ($type === 'index') {
                $indexes[] = $sql;
            } elseif ($type === 'trigger') {
                $triggers[] = $sql;
            }
        }

        $w->write("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n\n");

        if ($o->structure) {
            if ($o->dropFirst) {
                foreach (array_keys($views) as $view) {
                    $w->write('DROP VIEW IF EXISTS '.self::quote($view).";\n");
                }
                foreach (array_keys($tables) as $table) {
                    $w->write('DROP TABLE IF EXISTS '.self::quote($table).";\n");
                }
                $w->write("\n");
            }

            foreach ($tables as $create) {
                $p->checkCancelled();
                $w->write($create.";\n\n");
            }
        }

        if ($o->data) {
            foreach (array_keys($tables) as $table) {
                $p->checkCancelled();
                $this->data($pdo, $table, $kinds[$table] ?? ['type' => 'table', 'without_rowid' => false], $w, $p);
            }
            $this->sequences($pdo, $tables, $w);
            $w->write("\n");
        }

        if ($o->structure) {
            foreach ($indexes as $create) {
                $w->write($create.";\n");
            }
            foreach (self::inDependencyOrder($views) as $create) {
                $w->write($create.";\n");
            }
            foreach ($triggers as $create) {
                $w->write($create.";\n");
            }
            $w->write("\n");
        }

        $w->write("COMMIT;\n");
    }

    /** @param array{type: string, without_rowid: bool} $kind */
    private function data(PDO $pdo, string $table, array $kind, DumpWriter $w, TransferProgress $p): void
    {
        $columns = [];
        $taken = [];
        $primary = [];
        $info = $pdo->prepare('SELECT name, type, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid');
        $info->execute([$table]);
        foreach ($info->fetchAll(PDO::FETCH_NUM) as [$name, $type, $pk, $hidden]) {
            $taken[strtolower((string) $name)] = true;
            if ((int) $pk > 0) {
                $primary[] = strtoupper((string) $type);
            }
            // 1: a virtual table's hidden column, 2/3: VIRTUAL/STORED generated columns, which SQLite fills.
            if ((int) $hidden === 0) {
                $columns[] = self::quote((string) $name);
            }
        }
        if ($columns === []) {
            return;
        }

        // A rowid table keeps its rowids unless an INTEGER PRIMARY KEY already is the rowid.
        if ($kind['type'] === 'table' && ! $kind['without_rowid'] && $primary !== ['INTEGER']) {
            foreach (self::ROWID_NAMES as $rowid) {
                if (! isset($taken[$rowid])) {
                    array_unshift($columns, $rowid);
                    break;
                }
            }
        }

        // typeof() before each value: the storage class decides how the value is written.
        $select = implode(', ', array_map(fn (string $c) => "typeof({$c}), {$c}", $columns));
        $batcher = new InsertBatcher($w, 'INSERT INTO '.self::quote($table).' ('.implode(', ', $columns).') VALUES');

        $bytes = $w->bytesWritten();
        $pending = 0;
        $stmt = self::query($pdo, "SELECT {$select} FROM ".self::quote($table));
        try {
            while (($row = $stmt->fetch(PDO::FETCH_NUM)) !== false) {
                $values = [];
                for ($i = 0, $n = count($row); $i < $n; $i += 2) {
                    $values[] = $this->literal((string) $row[$i], $row[$i + 1]);
                }
                $batcher->add('('.implode(',', $values).')');

                if (++$pending === self::BATCH_ROWS) {
                    $p->advance(bytes: $w->bytesWritten() - $bytes, rows: $pending, table: $table);
                    $bytes = $w->bytesWritten();
                    $pending = 0;
                    $p->checkCancelled();
                }
            }
        } finally {
            // Ends the statement, so the read transaction can commit after an error or a cancel.
            $stmt->closeCursor();
        }

        $batcher->flush();
        $p->advance(bytes: $w->bytesWritten() - $bytes, rows: $pending, table: $table);
    }

    /**
     * AUTOINCREMENT positions, after the rows (whose inserts move them to max(rowid)): the source may be past that.
     *
     * @param  array<string, string>  $tables
     */
    private function sequences(PDO $pdo, array $tables, DumpWriter $w): void
    {
        if (self::query($pdo, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")->fetchColumn() === false) {
            return;
        }

        foreach (self::query($pdo, 'SELECT name, seq FROM sqlite_sequence ORDER BY rowid')->fetchAll(PDO::FETCH_NUM) as [$name, $seq]) {
            if (! isset($tables[(string) $name])) {
                continue;
            }
            $name = Literals::sqlite((string) $name, false);
            $w->write("DELETE FROM sqlite_sequence WHERE name = {$name};\n"
                ."INSERT INTO sqlite_sequence (name, seq) VALUES ({$name}, ".Literals::sqlite($seq, false).");\n");
        }
    }

    /** A value written as the storage class typeof() reported, so it comes back as the same class. */
    private function literal(string $type, mixed $value): string
    {
        if ($type === 'real' && is_float($value)) {
            return $this->real($value);
        }

        $ok = match ($type) {
            'null' => $value === null,
            'integer' => is_int($value),
            'text', 'blob' => is_string($value),
            default => false,
        };
        if (! $ok) {
            throw new UnexpectedValueException("Unexpected {$type} value of PHP type ".get_debug_type($value));
        }

        return Literals::sqlite($value, $type === 'blob');
    }

    /**
     * A REAL that any SQLite reads back bit for bit. SQLite's text-to-double conversion is not correctly rounded:
     * on this Windows build 1e-300 and 9.999999999999999e-301 swap places, and SQLite 3.37 reads
     * 123456789.12345679 one bit off. A decimal is therefore written only when it takes the exact path every such
     * parser has (Clinger's fast path: a significand below 2^53 scaled by 10^-22 .. 10^22, one rounding) and this
     * build reads it back exactly; any other value is written as its exact binary value, an integer mantissa
     * times or divided by powers of two.
     */
    private function real(float $v): string
    {
        if (! is_finite($v)) {
            return Literals::sqlite($v, false);
        }
        if ($this->parse === null) {
            throw new RuntimeException('REAL values are only written during an export');
        }

        $text = Literals::sqlite($v, false); // the shortest decimal that is this double
        if (preg_match('/^-?(\d+)\.(\d+)(?:E([+-]\d+))?$/', $text, $m) === 1) {
            $digits = ltrim($m[1].$m[2], '0');
            $scale = (int) ($m[3] ?? 0) - strlen($m[2]);
            $significand = rtrim($digits, '0');
            $scale += strlen($digits) - strlen($significand);
            $fast = $significand === ''
                || (strlen($significand) <= 16 && (int) $significand <= 2 ** 53 && abs($scale) <= 22);

            if ($fast) {
                $this->parse->execute([$text]);
                $back = $this->parse->fetch(PDO::FETCH_NUM);
                $this->parse->closeCursor();
                if (is_array($back) && is_float($back[0]) && pack('E', $back[0]) === pack('E', $v)) {
                    return $text;
                }
            }
        }

        return self::exactReal($v);
    }

    /** m * 2^e with an integer m below 2^53: every step of the expression is exact in IEEE doubles. */
    private static function exactReal(float $v): string
    {
        $raw = unpack('J', pack('E', $v));
        $raw = is_array($raw) ? (int) $raw[1] : 0;
        $exponent = ($raw >> 52) & 0x7FF;
        $mantissa = $raw & 0xFFFFFFFFFFFFF;
        if ($exponent === 0) {
            $e = -1074; // subnormal
        } else {
            $mantissa |= 1 << 52;
            $e = $exponent - 1075;
        }
        if ($mantissa === 0) {
            // A literal: SQLite negates at run time as 0 - x, which turns -0.0 into 0.0.
            return $raw < 0 ? '-0.0' : '0.0';
        }
        while (($mantissa & 1) === 0) {
            $mantissa >>= 1;
            $e++;
        }

        $sql = 'CAST('.$mantissa.' AS REAL)';
        $op = $e > 0 ? '*' : '/';
        for ($left = abs($e); $left > 0; $left -= 62) {
            $sql .= $op.($left >= 62 ? self::POW2_62 : 1 << $left);
        }

        return ($raw < 0 ? '-' : '').'('.$sql.')';
    }

    /**
     * CREATE VIEW statements, each after the chosen views it names. A false match (a column spelled like a view)
     * only reorders; a cycle (impossible for real views) keeps creation order.
     *
     * @param  array<string, string>  $views  name => CREATE VIEW, in creation order
     * @return list<string>
     */
    private static function inDependencyOrder(array $views): array
    {
        $ordered = [];
        $seen = [];
        $visit = function (string $view) use (&$visit, &$ordered, &$seen, $views): void {
            if (isset($seen[$view])) {
                return;
            }
            $seen[$view] = true;
            foreach (array_keys($views) as $other) {
                if ($other !== $view && self::names($views[$view], $other)) {
                    $visit($other);
                }
            }
            $ordered[] = $views[$view];
        };
        foreach (array_keys($views) as $view) {
            $visit($view);
        }

        return $ordered;
    }

    /** Whether $sql mentions $name as an identifier: bare (case-insensitive) or in any of SQLite's quotes. */
    private static function names(string $sql, string $name): bool
    {
        $quoted = [self::quote($name), '`'.str_replace('`', '``', $name).'`', '['.$name.']'];
        foreach ($quoted as $form) {
            if (str_contains($sql, $form)) {
                return true;
            }
        }

        return preg_match('/(?<![\w$])'.preg_quote($name, '/').'(?![\w$])/iu', $sql) === 1;
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

    private static function quote(string $name): string
    {
        return '"'.str_replace('"', '""', $name).'"';
    }
}
