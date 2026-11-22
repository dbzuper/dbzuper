<?php

namespace Tests\Support;

use Illuminate\Database\Connection;

/**
 * The backup/restore round-trip fixture: awkward types and values, a row over 2 MB, a composite key, a foreign-key
 * cycle, dependent views, a trigger (not on PostgreSQL, whose trigger needs a function), engine quirks (MySQL zero
 * dates and id 0, a MariaDB system-versioned table, PostgreSQL enum/identity/serial/sequence/partitions and a second
 * schema). Kept small apart from the one large row: these tests run often on a low-memory machine.
 */
final class TransferFixture
{
    /** Bytes in the large-text row: above 2 MiB, so it is larger than one ~1 MB INSERT batch and a read chunk. */
    public const BIG_TEXT_BYTES = 2_200_000;

    /** @var list<string> */
    public const PG_SCHEMAS = ['public', 'sales'];

    private const VIEWS = ['rt_big_orders', 'rt_order_totals'];

    public static function create(Connection $db, string $engine): void
    {
        match ($engine) {
            'pgsql' => self::createPostgres($db),
            'sqlite' => self::createSqlite($db),
            default => self::createMySql($db, $engine),
        };
    }

    public static function drop(Connection $db, string $engine): void
    {
        foreach (self::VIEWS as $view) {
            $db->statement("DROP VIEW IF EXISTS {$view}".($engine === 'pgsql' ? ' CASCADE' : ''));
        }

        $tables = ['rt_types', 'rt_big', 'rt_order_items', 'rt_cycle_a', 'rt_cycle_b'];
        if ($engine === 'pgsql') {
            $db->statement('DROP TABLE IF EXISTS '.implode(', ', [...$tables, 'rt_serial', 'rt_measurements']).' CASCADE');
            $db->statement('DROP SCHEMA IF EXISTS sales CASCADE');
            $db->statement('DROP TYPE IF EXISTS mood CASCADE');

            return;
        }

        $tables[] = $engine === 'sqlite' ? '"order"' : '`order`';
        if ($engine !== 'sqlite') {
            $tables[] = 'rt_quirks';
        }
        if ($engine === 'mariadb') {
            $tables[] = 'rt_versioned';
        }

        // The FK cycle cannot be dropped in any order with checks on.
        $db->statement($engine === 'sqlite' ? 'PRAGMA foreign_keys = OFF' : 'SET FOREIGN_KEY_CHECKS = 0');
        try {
            foreach ($tables as $table) {
                $db->statement("DROP TABLE IF EXISTS {$table}");
            }
        } finally {
            $db->statement($engine === 'sqlite' ? 'PRAGMA foreign_keys = ON' : 'SET FOREIGN_KEY_CHECKS = 1');
        }
    }

    /** Table keys as Fingerprint reports them. @return list<string> */
    public static function tableKeys(string $engine): array
    {
        $common = ['rt_types', 'rt_big', 'rt_order_items', 'rt_cycle_a', 'rt_cycle_b'];

        return match ($engine) {
            'pgsql' => [...array_map(fn ($t) => "public.{$t}", [...$common, 'rt_serial', 'rt_measurements']), 'sales.order'],
            'sqlite' => [...$common, 'order'],
            'mariadb' => [...$common, 'order', 'rt_quirks', 'rt_versioned'],
            default => [...$common, 'order', 'rt_quirks'],
        };
    }

    /** @return list<string> */
    public static function viewKeys(string $engine): array
    {
        return $engine === 'pgsql' ? array_map(fn ($v) => "public.{$v}", self::VIEWS) : self::VIEWS;
    }

    /** Over 2 MiB of multi-line text with quotes, backslashes, semicolons and multi-byte characters. */
    public static function bigText(): string
    {
        $unit = "Line with 'quotes', \"doubles\", \\back\\slashes, semicolons; -- not a comment; Läuft 東京 🚀\n";

        return str_repeat($unit, intdiv(self::BIG_TEXT_BYTES, strlen($unit)) + 1);
    }

    /** Bytes 0x00 .. $upTo. */
    public static function allBytes(int $upTo = 255): string
    {
        return implode('', array_map('chr', range(0, $upTo)));
    }

    /** A binary literal (bound strings are text on SQLite and PostgreSQL, so binary goes in as hex). */
    public static function binaryLiteral(string $engine, string $bytes): string
    {
        $hex = bin2hex($bytes);

        return match ($engine) {
            'pgsql' => "decode('{$hex}', 'hex')",
            'sqlite' => "X'{$hex}'",
            default => $hex === '' ? "''" : "0x{$hex}",
        };
    }

    private static function createMySql(Connection $db, string $engine): void
    {
        $bin = fn (string $bytes) => self::binaryLiteral($engine, $bytes);

        $db->statement("CREATE TABLE rt_types (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(20) NOT NULL,
            flag TINYINT(1) NULL DEFAULT 0,
            small_n SMALLINT NULL,
            big_n BIGINT UNSIGNED NULL,
            amount DECIMAL(12,4) NULL,
            ratio DOUBLE NULL,
            label VARCHAR(100) NULL DEFAULT 'none',
            body TEXT NULL,
            raw VARBINARY(300) NULL,
            blob_data BLOB NULL,
            doc JSON NULL,
            kind ENUM('alpha','beta','gamma') NULL,
            bits BIT(8) NULL,
            born DATE NULL,
            seen_at DATETIME(6) NULL,
            stamp TIMESTAMP NULL DEFAULT NULL,
            at_time TIME NULL,
            UNIQUE KEY rt_types_code_unique (code)
        ) COMMENT = 'types round trip'");
        $insert = 'INSERT INTO rt_types (id, code, flag, small_n, big_n, amount, ratio, label, body, raw, blob_data, doc, kind, bits, born, seen_at, stamp, at_time) VALUES ';
        $db->statement($insert."(1, 'full', 1, -32768, 18446744073709551615, 12345678.1234, 0.1, ?, ?, {$bin(self::allBytes())}, {$bin("\x00\xFF'\\")}, ?, 'beta', b'10100101', '2024-02-29', '2024-02-29 13:45:12.123456', '2024-02-29 13:45:12', '23:59:59')", self::fullValues());
        $db->statement($insert."(2, 'nulls', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)");
        $db->statement($insert."(3, 'edge', 0, 0, 0, -0.0001, 1e-300, ?, '', {$bin('')}, {$bin('')}, '[]', 'alpha', b'0', '1000-01-01', '9999-12-31 23:59:59.999999', '2000-01-01 00:00:00', '-838:59:59')", [self::edgeLabel()]);
        // Advance the counter past the highest id: a faithful restore keeps AUTO_INCREMENT, not max(id) + 1.
        $db->statement("INSERT INTO rt_types (id, code) VALUES (10, 'gone')");
        $db->delete('DELETE FROM rt_types WHERE id = 10');

        $db->statement('CREATE TABLE rt_big (id INT NOT NULL PRIMARY KEY, body LONGTEXT NOT NULL)');
        self::insertBig($db);

        $db->statement('CREATE TABLE rt_order_items (
            order_id INT NOT NULL,
            line_no SMALLINT NOT NULL,
            qty INT NOT NULL DEFAULT 1,
            price DECIMAL(10,2) NOT NULL,
            line_total DECIMAL(12,2) GENERATED ALWAYS AS (qty * price) STORED,
            note VARCHAR(50) NULL,
            PRIMARY KEY (order_id, line_no),
            KEY rt_order_items_qty_index (qty),
            CONSTRAINT rt_order_items_qty_check CHECK (qty > 0)
        )');
        self::insertOrderItems($db);

        self::createCycle($db, 'INT', fn () => [
            'ALTER TABLE rt_cycle_a ADD CONSTRAINT rt_cycle_a_b_fk FOREIGN KEY (b_id) REFERENCES rt_cycle_b (id) ON DELETE SET NULL ON UPDATE CASCADE',
        ]);

        $db->statement('CREATE TABLE `order` (id INT NOT NULL PRIMARY KEY, `we"ird` VARCHAR(20) NULL, `back``tick` VARCHAR(20) NULL, `with space` INT NULL)');
        $db->insert('INSERT INTO `order` (id, `we"ird`, `back``tick`, `with space`) VALUES (1, ?, ?, 7), (2, NULL, NULL, NULL)', ['x"y', 'a`b']);

        // Review Focus 5: a zero date and an AUTO_INCREMENT row with id 0 need a relaxed sql_mode to go in.
        $db->statement('CREATE TABLE rt_quirks (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, d DATE NULL)');
        $mode = (string) $db->selectOne('SELECT @@SESSION.sql_mode AS m')->m;
        $db->statement("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");
        try {
            $db->insert("INSERT INTO rt_quirks (id, d) VALUES (0, '0000-00-00'), (1, '2024-01-31')");
        } finally {
            $db->statement('SET SESSION sql_mode = ?', [$mode]);
        }

        if ($engine === 'mariadb') {
            $db->statement('CREATE TABLE rt_versioned (id INT NOT NULL PRIMARY KEY, v VARCHAR(20) NULL) WITH SYSTEM VERSIONING');
            $db->insert("INSERT INTO rt_versioned (id, v) VALUES (1, 'first'), (2, 'second')");
            $db->update("UPDATE rt_versioned SET v = 'changed' WHERE id = 2");
        }

        self::createViews($db);
        $db->statement("CREATE TRIGGER rt_order_items_note BEFORE UPDATE ON rt_order_items FOR EACH ROW SET NEW.note = CONCAT('updated: ', COALESCE(OLD.note, ''))");
    }

    private static function createSqlite(Connection $db): void
    {
        $bin = fn (string $bytes) => self::binaryLiteral('sqlite', $bytes);

        $db->statement("CREATE TABLE rt_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            flag INTEGER DEFAULT 0,
            small_n INTEGER,
            big_n INTEGER,
            amount NUMERIC,
            ratio REAL,
            label VARCHAR(100) DEFAULT 'none',
            body TEXT,
            raw BLOB,
            blob_data BLOB,
            doc TEXT,
            born TEXT,
            seen_at TEXT
        )");
        $db->statement('CREATE UNIQUE INDEX rt_types_code_unique ON rt_types (code)');
        $insert = 'INSERT INTO rt_types (id, code, flag, small_n, big_n, amount, ratio, label, body, raw, blob_data, doc, born, seen_at) VALUES ';
        $db->statement($insert."(1, 'full', 1, -32768, 9223372036854775807, 12345678.1234, 0.1, ?, ?, {$bin(self::allBytes())}, {$bin("\x00\xFF'\\")}, ?, '2024-02-29', '2024-02-29 13:45:12.123456')", self::fullValues());
        $db->statement($insert."(2, 'nulls', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)");
        // Empty text and blob, values that column affinity converts ('007', 1.5) and an integer in a BLOB column.
        $db->statement($insert."(3, 'edge', 0, 0, -9223372036854775808, '007', 1e-300, ?, '', {$bin('')}, 42, '[]', 1.5, '')", [self::edgeLabel()]);
        $db->statement("INSERT INTO rt_types (id, code) VALUES (10, 'gone')");
        $db->delete('DELETE FROM rt_types WHERE id = 10');

        $db->statement('CREATE TABLE rt_big (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
        self::insertBig($db);

        $db->statement('CREATE TABLE rt_order_items (
            order_id INTEGER NOT NULL,
            line_no INTEGER NOT NULL,
            qty INTEGER NOT NULL DEFAULT 1 CONSTRAINT rt_order_items_qty_check CHECK (qty > 0),
            price NUMERIC NOT NULL,
            line_total NUMERIC GENERATED ALWAYS AS (qty * price) STORED,
            note TEXT,
            PRIMARY KEY (order_id, line_no)
        )');
        $db->statement('CREATE INDEX rt_order_items_qty_index ON rt_order_items (qty)');
        self::insertOrderItems($db);

        // SQLite cannot add a constraint later, but a REFERENCES clause may name a table that does not exist yet.
        $db->statement('CREATE TABLE rt_cycle_a (id INTEGER PRIMARY KEY, b_id INTEGER NULL REFERENCES rt_cycle_b (id) ON DELETE SET NULL ON UPDATE CASCADE, name TEXT)');
        self::createCycle($db, 'INTEGER', fn () => [], createA: false);

        $db->statement('CREATE TABLE "order" (id INTEGER PRIMARY KEY, "we""ird" TEXT, "with space" INTEGER)');
        $db->insert('INSERT INTO "order" (id, "we""ird", "with space") VALUES (1, ?, 7), (2, NULL, NULL)', ['x"y']);

        self::createViews($db);
        $db->statement("CREATE TRIGGER rt_order_items_note AFTER UPDATE OF qty ON rt_order_items
            BEGIN
                UPDATE rt_order_items SET note = 'updated' WHERE order_id = NEW.order_id AND line_no = NEW.line_no;
            END");
    }

    private static function createPostgres(Connection $db): void
    {
        $bin = fn (string $bytes) => self::binaryLiteral('pgsql', $bytes);

        $db->statement("CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy')");
        $db->statement("CREATE TABLE rt_types (
            id INTEGER PRIMARY KEY,
            code VARCHAR(20) NOT NULL CONSTRAINT rt_types_code_unique UNIQUE,
            flag BOOLEAN DEFAULT false,
            small_n SMALLINT,
            big_n BIGINT,
            amount NUMERIC(12,4),
            ratio DOUBLE PRECISION,
            label VARCHAR(100) DEFAULT 'none',
            body TEXT,
            raw BYTEA,
            doc JSON,
            docb JSONB,
            feeling mood,
            tags TEXT[],
            uid UUID,
            born DATE,
            seen_at TIMESTAMP(6),
            stamp TIMESTAMPTZ,
            at_time TIME
        )");
        $db->statement("COMMENT ON TABLE rt_types IS 'types round trip'");
        $insert = 'INSERT INTO rt_types (id, code, flag, small_n, big_n, amount, ratio, label, body, raw, doc, docb, feeling, tags, uid, born, seen_at, stamp, at_time) VALUES ';
        [$label, $body, $doc] = self::fullValues();
        $db->statement($insert."(1, 'full', true, -32768, 9223372036854775807, 12345678.1234, 0.1, ?, ?, {$bin(self::allBytes())}, ?, ?, 'happy', ARRAY['a', 'b c', '\"q\"', NULL], 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '2024-02-29', '2024-02-29 13:45:12.123456', '2024-02-29 13:45:12+02', '23:59:59')", [$label, $body, $doc, $doc]);
        $db->statement($insert."(2, 'nulls', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)");
        $db->statement($insert."(3, 'edge', false, 0, -9223372036854775808, -0.0001, 'Infinity', ?, '', {$bin('')}, '[]', '{}', 'sad', '{}', '00000000-0000-0000-0000-000000000000', 'infinity', '-infinity', '1970-01-01 00:00:00+00', '00:00:00')", [self::edgeLabel()]);

        $db->statement('CREATE TABLE rt_big (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
        self::insertBig($db);

        $db->statement('CREATE TABLE rt_order_items (
            order_id INTEGER NOT NULL,
            line_no SMALLINT NOT NULL,
            qty INTEGER NOT NULL DEFAULT 1,
            price NUMERIC(10,2) NOT NULL,
            line_total NUMERIC(12,2) GENERATED ALWAYS AS (qty * price) STORED,
            note VARCHAR(50),
            PRIMARY KEY (order_id, line_no),
            CONSTRAINT rt_order_items_qty_check CHECK (qty > 0)
        )');
        $db->statement('CREATE INDEX rt_order_items_qty_index ON rt_order_items (qty)');
        self::insertOrderItems($db);

        self::createCycle($db, 'INTEGER', fn () => [
            'ALTER TABLE rt_cycle_a ADD CONSTRAINT rt_cycle_a_b_fk FOREIGN KEY (b_id) REFERENCES rt_cycle_b (id) ON DELETE SET NULL ON UPDATE CASCADE',
        ]);

        // A sequence-backed serial whose position is past max(id): a restore must setval, not guess.
        $db->statement('CREATE TABLE rt_serial (id SERIAL PRIMARY KEY, name TEXT)');
        $db->insert("INSERT INTO rt_serial (name) VALUES ('one'), ('two'), ('three')");
        $db->select("SELECT nextval('rt_serial_id_seq')");

        $db->statement('CREATE TABLE rt_measurements (id INTEGER NOT NULL, reading NUMERIC(6,2), PRIMARY KEY (id)) PARTITION BY RANGE (id)');
        $db->statement('CREATE TABLE rt_measurements_low PARTITION OF rt_measurements FOR VALUES FROM (0) TO (100)');
        $db->statement('CREATE TABLE rt_measurements_high PARTITION OF rt_measurements FOR VALUES FROM (100) TO (1000)');
        $db->insert('INSERT INTO rt_measurements (id, reading) VALUES (1, 1.25), (2, NULL), (150, -3.5)');

        // Review Focus 1: a second schema, a reserved-word table and a column with a double quote in its name.
        $db->statement('CREATE SCHEMA sales');
        $db->statement('CREATE TABLE sales."order" (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, "we""ird" TEXT, feeling mood NOT NULL DEFAULT \'ok\')');
        $db->insert('INSERT INTO sales."order" ("we""ird", feeling) VALUES (?, \'happy\'), (NULL, \'sad\'), (?, DEFAULT)', ['x"y', "it's"]);
        $db->statement('CREATE SEQUENCE sales.invoice_no START 1000 INCREMENT 5');
        $db->select("SELECT nextval('sales.invoice_no'), nextval('sales.invoice_no')");

        self::createViews($db);
    }

    /** @return array{string, string, string} label, body and JSON document of the "full" row */
    private static function fullValues(): array
    {
        return [
            "Grüße, 世界 — \"double\" 'single' \\ back",
            "multi\nline\r\ntext\twith tab and a trailing space ",
            '{"a": [1, 2.5, null, true], "ü": "x", "nested": {"k": "v"}}',
        ];
    }

    private static function edgeLabel(): string
    {
        // Emoji, right-to-left text and a combining accent.
        return "🚀 עברית e\u{301}";
    }

    private static function insertBig(Connection $db): void
    {
        $db->insert('INSERT INTO rt_big (id, body) VALUES (1, ?)', [self::bigText()]);
        $db->insert("INSERT INTO rt_big (id, body) VALUES (2, 'small')");
    }

    private static function insertOrderItems(Connection $db): void
    {
        $db->insert("INSERT INTO rt_order_items (order_id, line_no, qty, price, note) VALUES
            (1, 1, 2, 3.50, 'first'), (1, 2, 1, 10.00, NULL), (2, 1, 5, 4.25, 'second')");
    }

    /**
     * rt_cycle_a.b_id -> rt_cycle_b and rt_cycle_b.a_id -> rt_cycle_a, both nullable, with rows that point at each
     * other, so neither table can be loaded first with checks on.
     *
     * @param  callable(): list<string>  $closeCycle  statements adding rt_cycle_a's FK after rt_cycle_b exists
     */
    private static function createCycle(Connection $db, string $int, callable $closeCycle, bool $createA = true): void
    {
        if ($createA) {
            $db->statement("CREATE TABLE rt_cycle_a (id {$int} NOT NULL PRIMARY KEY, b_id {$int} NULL, name VARCHAR(20) NULL)");
        }
        $db->statement("CREATE TABLE rt_cycle_b (id {$int} NOT NULL PRIMARY KEY, a_id {$int} NULL,
            CONSTRAINT rt_cycle_b_a_fk FOREIGN KEY (a_id) REFERENCES rt_cycle_a (id) ON DELETE CASCADE)");
        foreach ($closeCycle() as $sql) {
            $db->statement($sql);
        }

        $db->insert("INSERT INTO rt_cycle_a (id, b_id, name) VALUES (1, NULL, 'one'), (2, NULL, 'two'), (3, NULL, NULL)");
        $db->insert('INSERT INTO rt_cycle_b (id, a_id) VALUES (1, 1), (2, 2), (3, NULL)');
        $db->update('UPDATE rt_cycle_a SET b_id = id WHERE id IN (1, 2)');
    }

    /** rt_big_orders depends on rt_order_totals and sorts before it, so alphabetical creation order fails. */
    private static function createViews(Connection $db): void
    {
        $db->statement('CREATE VIEW rt_order_totals AS SELECT order_id, SUM(line_total) AS total, COUNT(*) AS line_count FROM rt_order_items GROUP BY order_id');
        $db->statement('CREATE VIEW rt_big_orders AS SELECT order_id FROM rt_order_totals WHERE total > 10');
    }
}
