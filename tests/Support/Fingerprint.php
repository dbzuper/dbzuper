<?php

namespace Tests\Support;

use Closure;
use Illuminate\Database\Connection;
use PDO;

/**
 * A comparable picture of a whole database, for backup/restore round trips: Fingerprint::of(source) must equal
 * Fingerprint::of(restored). The same keys on every engine, exact within an engine: catalog type strings,
 * defaults, keys, indexes, view and trigger definitions, sequence positions, and per table a row count plus a
 * checksum over every row in primary-key order. Sorted deterministically, so expect($a)->toBe($b) shows a readable
 * diff of whatever was lost.
 *
 * @phpstan-type Print array{schemas: list<string>, tables: array<string, array<string, mixed>>, views: array<string, mixed>, triggers: array<string, mixed>, sequences: array<string, mixed>, enums: array<string, list<string>>}
 */
final class Fingerprint
{
    /** Suffix of the exact (DOUBLE) copy of a MySQL FLOAT column in a row query. */
    private const EXACT = '#exact';

    /**
     * @param  list<string>|null  $schemas  PostgreSQL only: limit to these schemas (default: every non-system one)
     * @return Print
     */
    public static function of(Connection $db, string $engine, ?array $schemas = null): array
    {
        $print = match ($engine) {
            'pgsql' => self::postgres($db, $schemas),
            'sqlite' => self::sqlite($db),
            default => self::mysql($db),
        };

        foreach (['tables', 'views', 'triggers', 'sequences', 'enums'] as $key) {
            ksort($print[$key], SORT_STRING);
        }

        return $print;
    }

    // ---------------------------------------------------------------- MySQL / MariaDB

    /** @return Print */
    private static function mysql(Connection $db): array
    {
        $database = (string) $db->selectOne('SELECT DATABASE() AS d')->d;
        // Catalog text such as view bodies names the database; restores go to another one.
        $local = fn (?string $sql) => $sql === null ? null : self::squash(str_replace('`'.$database.'`.', '', $sql));
        $q = fn (string $name) => '`'.str_replace('`', '``', $name).'`';

        $mariadb = str_contains((string) $db->selectOne('SELECT VERSION() AS v')->v, 'MariaDB');
        $binaryTypes = ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'bit', 'geometry', 'point', 'linestring', 'polygon'];

        // information_schema is slow per query on MySQL 8, so each catalog is read once for the whole database.
        $columns = [];
        $binary = [];
        $floats = [];
        foreach ($db->select('SELECT table_name AS tbl, column_name AS name, column_type AS type, data_type AS data_type, is_nullable AS nullable,
                column_default AS `default`, extra AS extra, generation_expression AS `generated`, character_set_name AS charset,
                collation_name AS collation, column_comment AS comment
            FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position') as $c) {
            $columns[(string) $c->tbl][] = [
                'name' => $c->name, 'type' => $c->type, 'nullable' => $c->nullable, 'default' => $c->default,
                'extra' => $c->extra, 'generated' => $local($c->generated ?: null), 'charset' => $c->charset,
                'collation' => $c->collation, 'comment' => $c->comment,
            ];
            if (in_array(strtolower((string) $c->data_type), $binaryTypes, true)) {
                $binary[(string) $c->tbl][(string) $c->name] = true;
            }
            if (strtolower((string) $c->data_type) === 'float') {
                $floats[(string) $c->tbl][] = (string) $c->name;
            }
        }

        $indexes = [];
        // SELECT *: MariaDB has no EXPRESSION column (functional key parts are MySQL 8 only).
        foreach ($db->select('SELECT * FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY table_name, index_name, seq_in_index') as $i) {
            $i = array_change_key_case((array) $i, CASE_LOWER);
            $index = &$indexes[(string) $i['table_name']][(string) $i['index_name']];
            $index['unique'] = ! (int) $i['non_unique'];
            $index['type'] = $i['index_type'];
            $index['columns'][] = [$i['column_name'], $i['collation'], $i['sub_part'], $i['expression'] ?? null];
            unset($index);
        }

        $foreign = [];
        foreach ($db->select('SELECT rc.table_name AS tbl, rc.constraint_name AS name, rc.update_rule AS update_rule, rc.delete_rule AS delete_rule,
                rc.referenced_table_name AS ref_table, k.column_name AS col, k.referenced_column_name AS ref_col, k.referenced_table_schema AS ref_schema
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage k ON k.constraint_schema = rc.constraint_schema
                AND k.constraint_name = rc.constraint_name AND k.table_name = rc.table_name
            WHERE rc.constraint_schema = DATABASE() ORDER BY rc.table_name, rc.constraint_name, k.ordinal_position') as $f) {
            $fk = &$foreign[(string) $f->tbl][(string) $f->name];
            $fk['references'] = ($f->ref_schema === $database ? '' : $f->ref_schema.'.').$f->ref_table;
            $fk['columns'][] = $f->col;
            $fk['referenced_columns'][] = $f->ref_col;
            $fk['on_update'] = $f->update_rule;
            $fk['on_delete'] = $f->delete_rule;
            unset($fk);
        }

        $checks = [];
        // MariaDB scopes check names per table (a column CHECK is named after its column).
        $sameTable = $mariadb ? ' AND cc.table_name = tc.table_name' : '';
        foreach ($db->select('SELECT tc.table_name AS tbl, tc.constraint_name AS name, cc.check_clause AS clause FROM information_schema.table_constraints tc
            JOIN information_schema.check_constraints cc ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name'.$sameTable.'
            WHERE tc.table_schema = DATABASE() AND tc.constraint_type = \'CHECK\'') as $c) {
            $checks[(string) $c->tbl][(string) $c->name] = $local($c->clause);
        }

        $tables = [];
        $views = [];
        $sequences = [];
        foreach ($db->select('SELECT table_name AS name, table_type AS type, engine AS engine, table_collation AS collation, table_comment AS comment
            FROM information_schema.tables WHERE table_schema = DATABASE()') as $t) {
            if ($t->type === 'VIEW') {
                continue;
            }
            $name = (string) $t->name;

            $tableIndexes = $indexes[$name] ?? [];
            ksort($tableIndexes, SORT_STRING);
            $primary = array_map(fn ($c) => (string) $c[0], $tableIndexes['PRIMARY']['columns'] ?? []);
            $tableForeign = $foreign[$name] ?? [];
            ksort($tableForeign, SORT_STRING);
            $tableChecks = $checks[$name] ?? [];
            ksort($tableChecks, SORT_STRING);

            $create = (string) array_values((array) $db->selectOne('SHOW CREATE TABLE '.$q($name)))[1];
            if (preg_match('/\bAUTO_INCREMENT=(\d+)/', $create, $m)) {
                $sequences[$name] = ['auto_increment' => (int) $m[1]];
            }

            $tables[$name] = [
                'options' => ['type' => $t->type, 'engine' => $t->engine, 'collation' => $t->collation, 'comment' => $t->comment],
                'ddl' => $local(preg_replace('/ AUTO_INCREMENT=\d+/', '', $create)),
                'columns' => $columns[$name] ?? [],
                'primary_key' => $primary,
                'foreign_keys' => $tableForeign,
                'indexes' => $tableIndexes,
                'checks' => $tableChecks,
                'partitions' => [],
                ...self::rows($db, 'SELECT *'.implode('', array_map(
                    // FLOAT reaches PHP rounded to 6 significant digits (mysqlnd), which would hide a rounded value;
                    // widened to DOUBLE on the server it is exact. rows() puts it back under the column's name.
                    fn (string $c) => ', '.$q($c).' + 0e0 AS '.$q($c.self::EXACT),
                    $floats[$name] ?? [],
                )).' FROM '.$q($name), $primary, $q, $binary[$name] ?? []),
            ];
        }

        foreach ($db->select('SELECT table_name AS name, view_definition AS definition, check_option AS check_option, is_updatable AS is_updatable, security_type AS security_type
            FROM information_schema.views WHERE table_schema = DATABASE()') as $v) {
            $views[(string) $v->name] = [
                'definition' => $local($v->definition), 'check_option' => $v->check_option,
                'updatable' => $v->is_updatable, 'security' => $v->security_type,
            ];
        }

        $triggers = [];
        foreach ($db->select('SELECT trigger_name AS name, event_object_table AS tbl, action_timing AS timing, event_manipulation AS event,
                action_order AS action_order, action_orientation AS orientation, action_statement AS statement
            FROM information_schema.triggers WHERE trigger_schema = DATABASE()') as $t) {
            $triggers[(string) $t->name] = [
                'table' => $t->tbl, 'timing' => $t->timing, 'event' => $t->event, 'order' => (int) $t->action_order,
                'orientation' => $t->orientation, 'statement' => $local($t->statement),
            ];
        }

        return ['schemas' => [], 'tables' => $tables, 'views' => $views, 'triggers' => $triggers, 'sequences' => $sequences, 'enums' => []];
    }

    // ---------------------------------------------------------------- SQLite

    /** @return Print */
    private static function sqlite(Connection $db): array
    {
        $q = fn (string $name) => '"'.str_replace('"', '""', $name).'"';
        $str = fn (string $sql) => "'".str_replace("'", "''", $sql)."'";

        $tables = [];
        $views = [];
        $triggers = [];
        foreach ($db->select("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name") as $o) {
            $name = (string) $o->name;
            if ($o->type === 'view') {
                $views[$name] = ['definition' => self::squash($o->sql)];

                continue;
            }
            if ($o->type === 'trigger') {
                $triggers[$name] = ['table' => $o->tbl_name, 'definition' => self::squash($o->sql)];

                continue;
            }
            if ($o->type !== 'table') {
                continue; // indexes are read per table below
            }

            $columns = [];
            $primary = [];
            foreach ($db->select('SELECT * FROM pragma_table_xinfo('.$str($name).') ORDER BY cid') as $c) {
                $columns[] = [
                    'name' => $c->name, 'type' => $c->type, 'not_null' => (int) $c->notnull,
                    'default' => $c->dflt_value, 'hidden' => (int) $c->hidden,
                ];
                if ((int) $c->pk > 0) {
                    $primary[(int) $c->pk] = (string) $c->name;
                }
            }
            ksort($primary);

            $foreign = [];
            foreach ($db->select('SELECT * FROM pragma_foreign_key_list('.$str($name).') ORDER BY id, seq') as $f) {
                $fk = &$foreign[(int) $f->id];
                $fk['references'] = $f->table;
                $fk['columns'][] = $f->from;
                $fk['referenced_columns'][] = $f->to;
                $fk['on_update'] = $f->on_update;
                $fk['on_delete'] = $f->on_delete;
                $fk['match'] = $f->match;
                unset($fk);
            }
            // pragma ids follow declaration order; key by content so the order of declaration does not matter.
            $keyed = [];
            foreach ($foreign as $fk) {
                $keyed[implode(',', $fk['columns']).' -> '.$fk['references']] = $fk;
            }
            ksort($keyed, SORT_STRING);

            $indexes = [];
            foreach ($db->select('SELECT * FROM pragma_index_list('.$str($name).')') as $i) {
                $indexColumns = array_map(
                    fn ($c) => [$c->name, (int) $c->desc, $c->coll],
                    $db->select('SELECT * FROM pragma_index_xinfo('.$str((string) $i->name).') WHERE key = 1 ORDER BY seqno'),
                );
                $sql = $db->selectOne("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?", [$i->name])?->sql;
                $indexes[(string) $i->name] = [
                    'unique' => (bool) $i->unique, 'origin' => $i->origin, 'partial' => (int) $i->partial,
                    'columns' => $indexColumns, 'definition' => $sql === null ? null : self::squash($sql),
                ];
            }
            ksort($indexes, SORT_STRING);

            // typeof() beside every value: a blob that became text (or an integer that became real) is a change.
            $select = implode(', ', array_map(fn ($c) => 'typeof('.$q($c['name']).'), '.$q($c['name']), $columns));

            $tables[$name] = [
                'options' => [],
                'ddl' => self::squash($o->sql),
                'columns' => $columns,
                'primary_key' => array_values($primary),
                'foreign_keys' => $keyed,
                'indexes' => $indexes,
                'checks' => [],
                'partitions' => [],
                ...self::rows($db, "SELECT {$select} FROM ".$q($name), array_values($primary), $q, [], typed: true),
            ];
        }

        $sequences = [];
        if ($db->selectOne("SELECT 1 AS x FROM sqlite_master WHERE name = 'sqlite_sequence'") !== null) {
            foreach ($db->select('SELECT name, seq FROM sqlite_sequence') as $s) {
                $sequences[(string) $s->name] = ['seq' => (int) $s->seq];
            }
        }

        return ['schemas' => [], 'tables' => $tables, 'views' => $views, 'triggers' => $triggers, 'sequences' => $sequences, 'enums' => []];
    }

    // ---------------------------------------------------------------- PostgreSQL

    /**
     * @param  list<string>|null  $only
     * @return Print
     */
    private static function postgres(Connection $db, ?array $only): array
    {
        $q = fn (string $name) => '"'.str_replace('"', '""', $name).'"';

        $schemas = array_map(fn ($r) => (string) $r->nspname, $db->select("SELECT nspname FROM pg_namespace
            WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp\\_%'
            ORDER BY nspname"));
        if ($only !== null) {
            $schemas = array_values(array_intersect($schemas, $only));
        }
        // Schemas as a text[] literal for "= ANY(?::text[])".
        $in = '{'.implode(',', array_map(fn ($s) => '"'.addcslashes($s, '"\\').'"', $schemas)).'}';
        // Objects that belong to an extension come with CREATE EXTENSION, not with the dump.
        $notExtension = "NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')";

        $tables = [];
        foreach ($db->select("SELECT c.oid, n.nspname AS schema, c.relname AS name, c.relkind::text AS kind,
                CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS partition_key,
                obj_description(c.oid, 'pg_class') AS comment, c.relpersistence::text AS persistence
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname = ANY(?::text[]) AND {$notExtension}", [$in]) as $t) {
            $oid = (int) $t->oid;
            $key = $t->schema.'.'.$t->name;

            $columns = [];
            $binary = [];
            foreach ($db->select('SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
                    pg_get_expr(d.adbin, d.adrelid) AS default_expr, a.attidentity::text AS identity, a.attgenerated::text AS generated,
                    CASE WHEN a.attcollation <> ty.typcollation THEN co.collname END AS collation, col_description(a.attrelid, a.attnum) AS comment
                FROM pg_attribute a
                JOIN pg_type ty ON ty.oid = a.atttypid
                LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                LEFT JOIN pg_collation co ON co.oid = a.attcollation
                WHERE a.attrelid = ? AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum', [$oid]) as $c) {
                $columns[] = [
                    'name' => $c->name, 'type' => $c->type, 'not_null' => (bool) $c->not_null, 'default' => $c->default_expr,
                    'identity' => $c->identity, 'generated' => $c->generated, 'collation' => $c->collation, 'comment' => $c->comment,
                ];
                if ($c->type === 'bytea') {
                    $binary[(string) $c->name] = true;
                }
            }

            $primary = array_map(fn ($r) => (string) $r->attname, $db->select("SELECT a.attname FROM pg_constraint con
                CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, pos)
                JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
                WHERE con.conrelid = ? AND con.contype = 'p' ORDER BY k.pos", [$oid]));

            $foreign = [];
            $checks = [];
            foreach ($db->select('SELECT con.conname AS name, con.contype::text AS type, pg_get_constraintdef(con.oid) AS definition,
                    con.confrelid::regclass::text AS ref_table, con.confupdtype::text AS on_update, con.confdeltype::text AS on_delete,
                    (SELECT array_agg(a.attname ORDER BY k.pos)::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, pos)
                        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols,
                    (SELECT array_agg(a.attname ORDER BY k.pos)::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, pos)
                        JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_cols
                FROM pg_constraint con WHERE con.conrelid = ?', [$oid]) as $c) {
                if ($c->type === 'f') {
                    $foreign[(string) $c->name] = [
                        'references' => $c->ref_table, 'columns' => $c->cols, 'referenced_columns' => $c->ref_cols,
                        'on_update' => $c->on_update, 'on_delete' => $c->on_delete, 'definition' => $c->definition,
                    ];
                } else {
                    // Primary key, unique, check, exclusion and (PostgreSQL 18) named NOT NULL constraints.
                    $checks[(string) $c->name] = $c->type.': '.$c->definition;
                }
            }
            ksort($foreign, SORT_STRING);
            ksort($checks, SORT_STRING);

            $indexes = [];
            foreach ($db->select('SELECT i.relname AS name, x.indisunique AS is_unique, x.indisprimary AS is_primary, pg_get_indexdef(i.oid) AS definition
                FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = ?', [$oid]) as $i) {
                $indexes[(string) $i->name] = ['unique' => (bool) $i->is_unique, 'primary' => (bool) $i->is_primary, 'definition' => $i->definition];
            }
            ksort($indexes, SORT_STRING);

            // A partitioned table is read through its parent; each partition keeps its bounds and row count.
            $partitions = [];
            foreach ($db->select('SELECT n.nspname AS schema, c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
                FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE i.inhparent = ?', [$oid]) as $p) {
                $partitions[$p->schema.'.'.$p->name] = [
                    'bound' => $p->bound,
                    'rows' => (int) $db->selectOne('SELECT count(*) AS n FROM '.$q($p->schema).'.'.$q($p->name))->n,
                ];
            }
            ksort($partitions, SORT_STRING);

            $tables[$key] = [
                'options' => ['kind' => $t->kind, 'partition_key' => $t->partition_key, 'comment' => $t->comment, 'persistence' => $t->persistence],
                'ddl' => null,
                'columns' => $columns,
                'primary_key' => $primary,
                'foreign_keys' => $foreign,
                'indexes' => $indexes,
                'checks' => $checks,
                'partitions' => $partitions,
                ...self::rows($db, 'SELECT * FROM '.$q($t->schema).'.'.$q($t->name), $primary, $q, $binary),
            ];
        }

        $views = [];
        foreach ($db->select("SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind, pg_get_viewdef(c.oid, true) AS definition
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('v', 'm') AND n.nspname = ANY(?::text[]) AND {$notExtension}", [$in]) as $v) {
            $views[$v->schema.'.'.$v->name] = ['kind' => $v->kind, 'definition' => self::squash($v->definition)];
        }

        $triggers = [];
        foreach ($db->select('SELECT n.nspname AS schema, c.relname AS tbl, t.tgname AS name, pg_get_triggerdef(t.oid) AS definition, t.tgenabled::text AS enabled
            FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE NOT t.tgisinternal AND n.nspname = ANY(?::text[])', [$in]) as $t) {
            $triggers[$t->schema.'.'.$t->tbl.'.'.$t->name] = ['definition' => self::squash($t->definition), 'enabled' => $t->enabled];
        }

        $sequences = [];
        foreach ($db->select("SELECT n.nspname AS schema, c.relname AS name, format_type(s.seqtypid, NULL) AS type, s.seqstart AS start,
                s.seqincrement AS increment, s.seqmin AS min, s.seqmax AS max, s.seqcache AS cache, s.seqcycle AS cycle,
                (SELECT d.deptype::text || ' ' || tn.nspname || '.' || tc.relname || '.' || a.attname FROM pg_depend d
                    JOIN pg_class tc ON tc.oid = d.refobjid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
                    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_class'::regclass
                        AND d.deptype IN ('a', 'i') LIMIT 1) AS owned_by
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_sequence s ON s.seqrelid = c.oid
            WHERE c.relkind = 'S' AND n.nspname = ANY(?::text[]) AND {$notExtension}", [$in]) as $s) {
            $state = $db->selectOne('SELECT last_value, is_called FROM '.$q($s->schema).'.'.$q($s->name));
            $sequences[$s->schema.'.'.$s->name] = [
                'last_value' => (int) $state->last_value, 'is_called' => (bool) $state->is_called, 'type' => $s->type,
                'start' => (int) $s->start, 'increment' => (int) $s->increment, 'min' => (int) $s->min, 'max' => (int) $s->max,
                'cache' => (int) $s->cache, 'cycle' => (bool) $s->cycle, 'owned_by' => $s->owned_by,
            ];
        }

        $enums = [];
        foreach ($db->select('SELECT n.nspname AS schema, t.typname AS name, e.enumlabel AS label FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE n.nspname = ANY(?::text[]) ORDER BY n.nspname, t.typname, e.enumsortorder', [$in]) as $e) {
            $enums[$e->schema.'.'.$e->name][] = (string) $e->label;
        }

        return ['schemas' => $schemas, 'tables' => $tables, 'views' => $views, 'triggers' => $triggers, 'sequences' => $sequences, 'enums' => $enums];
    }

    // ---------------------------------------------------------------- rows

    /**
     * Streams the rows straight from PDO in primary-key order: a row count and a SHA-256 over one JSON line per
     * row. Binary columns (and anything that is not valid UTF-8) are hex-encoded; PostgreSQL bytea may arrive as a
     * stream. A table without a primary key has no stable order, so its lines are sorted before hashing.
     *
     * @param  list<string>  $primary
     * @param  Closure(string): string  $quote
     * @param  array<string, true>  $binary
     * @return array{rows: int, checksum: string}
     */
    private static function rows(Connection $db, string $sql, array $primary, Closure $quote, array $binary, bool $typed = false): array
    {
        if ($primary !== []) {
            $sql .= ' ORDER BY '.implode(', ', array_map($quote, $primary));
        }
        $statement = $db->getPdo()->query($sql);
        $unordered = [];
        $hash = hash_init('sha256');
        $rows = 0;
        while (($row = $statement->fetch($typed ? PDO::FETCH_NUM : PDO::FETCH_ASSOC)) !== false) {
            if ($typed) {
                // SQLite: pairs of typeof(col), col.
                $values = [];
                for ($i = 0; $i < count($row); $i += 2) {
                    $values[] = [$row[$i], $row[$i] === 'blob' ? 'hex:'.bin2hex((string) $row[$i + 1]) : self::value($row[$i + 1], false)];
                }
                $row = $values;
            } else {
                foreach ($row as $column => $value) {
                    if (str_ends_with((string) $column, self::EXACT)) {
                        unset($row[$column]);
                        $row[substr((string) $column, 0, -strlen(self::EXACT))] = $value;
                    } else {
                        $row[$column] = self::value($value, isset($binary[$column]));
                    }
                }
            }
            $line = json_encode($row, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION)."\n";
            if ($primary === []) {
                $unordered[] = $line;
            } else {
                hash_update($hash, $line);
            }
            $rows++;
        }
        $statement->closeCursor();
        sort($unordered, SORT_STRING);
        foreach ($unordered as $line) {
            hash_update($hash, $line);
        }

        return ['rows' => $rows, 'checksum' => hash_final($hash)];
    }

    private static function value(mixed $value, bool $binary): mixed
    {
        if (is_resource($value)) {
            $value = (string) stream_get_contents($value);
        }
        if (is_string($value) && ($binary || ! mb_check_encoding($value, 'UTF-8'))) {
            return 'hex:'.bin2hex($value);
        }
        if (is_float($value) && ! is_finite($value)) {
            return 'float:'.$value;
        }

        return $value;
    }

    private static function squash(?string $sql): ?string
    {
        return $sql === null ? null : trim((string) preg_replace('/\s+/u', ' ', $sql));
    }
}
