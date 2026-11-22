<?php

namespace App\Transfers\Export;

use Illuminate\Database\Connection;
use PDO;
use RuntimeException;

/**
 * Catalog → DDL for the built-in PostgreSQL backup (spec §2 "Built-in export").
 *
 * Every query runs on the export's raw PDO session, which PostgresBuiltinExporter has put inside its REPEATABLE READ
 * snapshot with search_path = '' (pg_catalog only). That makes format_type, pg_get_expr, pg_get_constraintdef,
 * pg_get_indexdef and pg_get_viewdef schema-qualify every name they print, so the statements restore under any
 * search_path. Statements are returned without their terminating semicolon.
 *
 * @phpstan-type Relation array{oid: int, schema: string, name: string, kind: string, persistence: string, top: bool, partitionOf: ?int, bound: ?string, partitionKey: ?string, inherits: list<int>, options: list<string>, comment: ?string}
 * @phpstan-type Column array{name: string, type: string, not_null: bool, identity: string, generated: string, default_expr: ?string, collation: ?string, comment: ?string, is_bytea: bool, read_as: ?string, attnum: int}
 * @phpstan-type Sequence array{oid: int, schema: string, name: string, type: string, start: string, increment: string, min: string, max: string, cache: string, cycle: bool, persistence: string, owner: ?int, ownerColumn: ?string, ifNotExists: bool, comment: ?string}
 */
final class PostgresDdl
{
    /** Schemas that hold the system, never user data. */
    private const USER_SCHEMA = "n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'";

    /** The object (pg_class row "c") belongs to an extension: CREATE EXTENSION brings it, the backup doesn't. */
    private const EXTENSION_MEMBER = "EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass
        AND e.objid = c.oid AND e.deptype = 'e')";

    public static function quote(string $name): string
    {
        return '"'.str_replace('"', '""', $name).'"';
    }

    public static function qualified(string $schema, string $name): string
    {
        return self::quote($schema).'.'.self::quote($name);
    }

    public static function serverVersion(Connection $db): int
    {
        return (int) self::value($db, "SELECT current_setting('server_version_num')");
    }

    /**
     * The chosen tables (never extension members) plus all their partitions, recursively, in creation order:
     * inheritance parents before their children, a partitioned table before its partitions.
     *
     * @param  list<DumpObject>  $tables
     * @return list<Relation>
     */
    public static function relations(Connection $db, array $tables): array
    {
        $all = [];
        $byName = [];
        $partitions = [];
        foreach (self::rows($db, "SELECT c.oid, n.nspname AS schema, c.relname AS name, c.relkind::text AS kind,
                c.relpersistence::text AS persistence, c.relispartition AS is_partition,
                pg_get_expr(c.relpartbound, c.oid) AS bound,
                CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS partition_key,
                array_to_json(c.reloptions)::text AS options, obj_description(c.oid, 'pg_class') AS comment,
                (SELECT json_agg(i.inhparent::bigint ORDER BY i.inhseqno)::text FROM pg_inherits i WHERE i.inhrelid = c.oid) AS parents,
                ".self::EXTENSION_MEMBER." AS extension
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p') AND ".self::USER_SCHEMA.'
            ORDER BY n.nspname, c.relname') as $r) {
            $parents = array_values(array_map('intval', (array) json_decode((string) ($r['parents'] ?? '[]'), true)));
            $partition = (bool) $r['is_partition'];
            $rel = [
                'oid' => (int) $r['oid'],
                'schema' => (string) $r['schema'],
                'name' => (string) $r['name'],
                'kind' => (string) $r['kind'],
                'persistence' => (string) $r['persistence'],
                'top' => ! $partition,
                'partitionOf' => $partition ? ($parents[0] ?? null) : null,
                'bound' => $partition ? (string) $r['bound'] : null,
                'partitionKey' => $r['partition_key'] === null ? null : (string) $r['partition_key'],
                'inherits' => $partition ? [] : $parents,
                'options' => self::stringList($r['options']),
                'comment' => self::nullableString($r['comment']),
            ];
            if ((bool) $r['extension']) {
                continue;
            }
            $all[$rel['oid']] = $rel;
            $byName[$rel['schema']."\0".$rel['name']] = $rel['oid'];
            if ($rel['partitionOf'] !== null) {
                $partitions[$rel['partitionOf']][] = $rel['oid'];
            }
        }

        // Every chosen table and the partitions under it.
        $chosen = [];
        $add = function (int $oid) use (&$add, &$chosen, $partitions): void {
            $chosen[$oid] = true;
            foreach ($partitions[$oid] ?? [] as $child) {
                $add($child);
            }
        };
        foreach ($tables as $table) {
            $oid = $byName[($table->schema ?? 'public')."\0".$table->name] ?? null;
            if ($oid !== null && $all[$oid]['top']) {
                $add($oid);
            }
        }

        $ordered = [];
        $visit = function (int $oid) use (&$visit, &$ordered, $all, $chosen, $partitions): void {
            if (isset($ordered[$oid])) {
                return;
            }
            $ordered[$oid] = null; // placeholder: also stops an (impossible) inheritance cycle
            foreach ($all[$oid]['inherits'] as $parent) {
                if (isset($chosen[$parent])) {
                    $visit($parent);
                }
            }
            unset($ordered[$oid]);
            $ordered[$oid] = $all[$oid];
            foreach ($partitions[$oid] ?? [] as $child) {
                $visit($child);
            }
        };
        foreach (array_keys($all) as $oid) {
            if (isset($chosen[$oid]) && $all[$oid]['top']) {
                $visit($oid);
            }
        }

        return array_values(array_filter($ordered));
    }

    /**
     * CREATE SCHEMA IF NOT EXISTS for each schema the backup puts something in (with $all: every user schema,
     * empty ones included). Never "public": it exists already, and the restoring role may lack CREATE on the database.
     *
     * @param  list<string>  $used
     * @return list<string>
     */
    public static function schemas(Connection $db, array $used, bool $all): array
    {
        if ($all) {
            $used = [...$used, ...array_map(fn ($r) => (string) $r['nspname'], self::rows($db, 'SELECT n.nspname FROM pg_namespace n
                WHERE '.self::USER_SCHEMA." AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_namespace'::regclass
                    AND e.objid = n.oid AND e.deptype = 'e')"))];
        }
        $used = array_values(array_unique(array_diff($used, ['public'])));
        sort($used, SORT_STRING);

        return array_map(fn (string $s) => 'CREATE SCHEMA IF NOT EXISTS '.self::quote($s), $used);
    }

    /**
     * Enum types: with $all every one in a user schema, otherwise those the relations' columns use (directly or as
     * an array). The labels keep their sort order.
     *
     * @param  list<Relation>  $relations
     * @return list<array{schema: string, name: string, labels: list<string>, comment: ?string}>
     */
    public static function enumTypes(Connection $db, array $relations, bool $all): array
    {
        $where = $all
            ? self::USER_SCHEMA." AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_type'::regclass AND e.objid = t.oid AND e.deptype = 'e')"
            : 't.oid IN (SELECT ty.oid FROM pg_attribute a JOIN pg_type ty ON ty.oid = a.atttypid OR ty.typarray = a.atttypid
                WHERE a.attrelid = ANY(?::oid[]) AND a.attnum > 0 AND NOT a.attisdropped)';
        $types = [];
        foreach (self::rows($db, "SELECT n.nspname AS schema, t.typname AS name, e.enumlabel AS label, obj_description(t.oid, 'pg_type') AS comment
            FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE t.typtype = 'e' AND {$where}
            ORDER BY n.nspname, t.typname, e.enumsortorder", $all ? [] : [self::oids($relations)]) as $r) {
            $key = $r['schema']."\0".$r['name'];
            $types[$key] ??= ['schema' => (string) $r['schema'], 'name' => (string) $r['name'], 'labels' => [], 'comment' => self::nullableString($r['comment'])];
            $types[$key]['labels'][] = (string) $r['label'];
        }

        return array_values($types);
    }

    /** @param array{schema: string, name: string, labels: list<string>} $enum */
    public static function createEnum(array $enum): string
    {
        return 'CREATE TYPE '.self::qualified($enum['schema'], $enum['name']).' AS ENUM ('
            .implode(', ', array_map(fn (string $l) => Literals::postgres($l, false), $enum['labels'])).')';
    }

    /**
     * Sequences other than identity ones (those come with their column): with $all every one in a user schema,
     * otherwise the ones the relations own or name in a column default. A sequence a chosen table only uses (not
     * owns) is created IF NOT EXISTS, as the target may share it with tables outside the backup.
     *
     * @param  list<Relation>  $relations
     * @return list<Sequence>
     */
    public static function sequences(Connection $db, array $relations, bool $all): array
    {
        $oids = array_flip(array_column($relations, 'oid'));
        $used = [];
        if (! $all && $oids !== []) {
            foreach (self::rows($db, "SELECT DISTINCT d.refobjid AS oid FROM pg_attrdef ad
                JOIN pg_depend d ON d.classid = 'pg_attrdef'::regclass AND d.objid = ad.oid AND d.refclassid = 'pg_class'::regclass
                JOIN pg_class s ON s.oid = d.refobjid AND s.relkind = 'S'
                WHERE ad.adrelid = ANY(?::oid[])", [self::oids($relations)]) as $r) {
                $used[(int) $r['oid']] = true;
            }
        }

        $sequences = [];
        foreach (self::rows($db, "SELECT c.oid, n.nspname AS schema, c.relname AS name, format_type(s.seqtypid, NULL) AS type,
                s.seqstart::text AS start, s.seqincrement::text AS increment, s.seqmin::text AS min, s.seqmax::text AS max,
                s.seqcache::text AS cache, s.seqcycle AS cycle, c.relpersistence::text AS persistence,
                own.refobjid AS owner, own.deptype::text AS deptype, a.attname AS owner_column,
                obj_description(c.oid, 'pg_class') AS comment, ".self::EXTENSION_MEMBER.' AS extension
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_sequence s ON s.seqrelid = c.oid
            LEFT JOIN pg_depend own ON own.classid = \'pg_class\'::regclass AND own.objid = c.oid
                AND own.refclassid = \'pg_class\'::regclass AND own.deptype IN (\'a\', \'i\')
            LEFT JOIN pg_attribute a ON a.attrelid = own.refobjid AND a.attnum = own.refobjsubid
            WHERE c.relkind = \'S\' AND '.self::USER_SCHEMA.'
            ORDER BY n.nspname, c.relname') as $r) {
            $oid = (int) $r['oid'];
            $owner = $r['owner'] === null ? null : (int) $r['owner'];
            if ($r['deptype'] === 'i' || (bool) $r['extension']) {
                continue;
            }
            $owned = $owner !== null && isset($oids[$owner]);
            if (! $all && ! $owned && ! isset($used[$oid])) {
                continue;
            }
            $sequences[] = [
                'oid' => $oid,
                'schema' => (string) $r['schema'],
                'name' => (string) $r['name'],
                'type' => (string) $r['type'],
                'start' => self::integer($r['start']),
                'increment' => self::integer($r['increment']),
                'min' => self::integer($r['min']),
                'max' => self::integer($r['max']),
                'cache' => self::integer($r['cache']),
                'cycle' => (bool) $r['cycle'],
                'persistence' => (string) $r['persistence'],
                'owner' => $owned ? $owner : null,
                'ownerColumn' => $owned ? (string) $r['owner_column'] : null,
                'ifNotExists' => ! $all && ! $owned,
                'comment' => self::nullableString($r['comment']),
            ];
        }

        return $sequences;
    }

    /** @param Sequence $s */
    public static function createSequence(array $s): string
    {
        return 'CREATE '.($s['persistence'] === 'u' ? 'UNLOGGED ' : '').'SEQUENCE '.($s['ifNotExists'] ? 'IF NOT EXISTS ' : '')
            .self::qualified($s['schema'], $s['name']).' AS '.$s['type'].' '.self::sequenceOptions($s);
    }

    /**
     * ALTER SEQUENCE … OWNED BY, once the owning tables exist.
     *
     * @param  list<Sequence>  $sequences
     * @param  list<Relation>  $relations
     * @return list<string>
     */
    public static function ownedBy(array $sequences, array $relations): array
    {
        $byOid = array_column($relations, null, 'oid');
        $out = [];
        foreach ($sequences as $s) {
            if ($s['owner'] !== null && isset($byOid[$s['owner']])) {
                $table = $byOid[$s['owner']];
                $out[] = 'ALTER SEQUENCE '.self::qualified($s['schema'], $s['name']).' OWNED BY '
                    .self::qualified($table['schema'], $table['name']).'.'.self::quote((string) $s['ownerColumn']);
            }
        }

        return $out;
    }

    /**
     * Insertable and generated columns of a table, in table order.
     *
     * @return list<Column>
     */
    public static function columns(Connection $db, int $oid): array
    {
        return array_map(fn (array $r) => [
            'name' => (string) $r['name'],
            'type' => (string) $r['type'],
            'not_null' => (bool) $r['not_null'],
            'identity' => (string) $r['identity'],
            'generated' => (string) $r['generated'],
            'default_expr' => self::nullableString($r['default_expr']),
            'collation' => self::nullableString($r['collation']),
            'comment' => self::nullableString($r['comment']),
            'is_bytea' => (bool) $r['is_bytea'],
            'read_as' => self::nullableString($r['read_as']),
            'attnum' => (int) $r['attnum'],
        ], self::rows($db, "SELECT a.attnum, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
                a.attidentity::text AS identity, a.attgenerated::text AS generated, pg_get_expr(d.adbin, d.adrelid) AS default_expr,
                CASE WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation
                    THEN quote_ident(cn.nspname) || '.' || quote_ident(co.collname) END AS collation,
                col_description(a.attrelid, a.attnum) AS comment,
                a.atttypid = 'bytea'::regtype AS is_bytea,
                -- money prints with the server's lc_monetary: read and written as numeric instead
                CASE a.atttypid WHEN 'money'::regtype THEN 'pg_catalog.numeric' WHEN 'money[]'::regtype THEN 'pg_catalog.numeric[]' END AS read_as
            FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            LEFT JOIN pg_collation co ON co.oid = a.attcollation LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
            WHERE a.attrelid = ? AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum", [$oid]));
    }

    /**
     * CREATE TABLE with columns, defaults, identity, generated columns and the constraints that hold on an empty
     * table (primary key, unique, exclusion, validated check and, from PostgreSQL 18, named NOT NULL). A partition
     * is created PARTITION OF its parent with its bound; columns and inherited constraints come from the parent.
     *
     * @param  Relation  $rel
     * @param  array<int, Relation>  $byOid  the relations in the backup
     */
    public static function createTable(Connection $db, array $rel, array $byOid, int $version): string
    {
        $prefix = 'CREATE '.($rel['persistence'] === 'u' ? 'UNLOGGED ' : '').'TABLE '.self::qualified($rel['schema'], $rel['name']);
        $constraints = array_map(
            fn (array $c) => 'CONSTRAINT '.self::quote($c['name']).' '.$c['definition'],
            array_filter(self::constraints($db, $rel['oid']), fn (array $c) => self::inCreateTable($c)),
        );
        $suffix = ($rel['partitionKey'] !== null ? ' PARTITION BY '.$rel['partitionKey'] : '').self::withOptions($rel['options']);

        if ($rel['partitionOf'] !== null) {
            $parent = $byOid[$rel['partitionOf']] ?? throw new RuntimeException("Partition {$rel['name']} without its parent");

            return $prefix.' PARTITION OF '.self::qualified($parent['schema'], $parent['name'])
                .($constraints === [] ? '' : " (\n    ".implode(",\n    ", $constraints)."\n)")
                .' '.$rel['bound'].$suffix;
        }

        $lines = [];
        foreach (self::columns($db, $rel['oid']) as $c) {
            $lines[] = self::columnDefinition($db, $rel['oid'], $c, $version);
        }
        $parents = array_values(array_filter($rel['inherits'], fn (int $p) => isset($byOid[$p])));

        return $prefix." (\n    ".implode(",\n    ", [...$lines, ...$constraints])."\n)"
            .($parents === [] ? '' : ' INHERITS ('.implode(', ', array_map(
                fn (int $p) => self::qualified($byOid[$p]['schema'], $byOid[$p]['name']),
                $parents,
            )).')')
            .$suffix;
    }

    /**
     * A partition starts with its parent's column defaults (PARTITION OF copies them); where the source partition's
     * own default differs, set or drop it.
     *
     * @param  Relation  $rel
     * @return list<string>
     */
    public static function partitionDefaults(Connection $db, array $rel): array
    {
        if ($rel['partitionOf'] === null) {
            return [];
        }

        $table = self::qualified($rel['schema'], $rel['name']);

        return array_map(
            fn (array $r) => 'ALTER TABLE '.$table.' ALTER COLUMN '.self::quote((string) $r['name'])
                .($r['own'] === null ? ' DROP DEFAULT' : ' SET DEFAULT '.$r['own']),
            self::rows($db, "SELECT a.attname AS name, pg_get_expr(cd.adbin, cd.adrelid) AS own
                FROM pg_attribute a
                JOIN pg_attribute pa ON pa.attrelid = ? AND pa.attname = a.attname AND pa.attnum > 0 AND NOT pa.attisdropped
                LEFT JOIN pg_attrdef cd ON cd.adrelid = a.attrelid AND cd.adnum = a.attnum
                LEFT JOIN pg_attrdef pd ON pd.adrelid = pa.attrelid AND pd.adnum = pa.attnum
                WHERE a.attrelid = ? AND a.attnum > 0 AND NOT a.attisdropped
                  AND a.attgenerated = '' AND a.attidentity = '' AND pa.attgenerated = '' AND pa.attidentity = ''
                  AND pg_get_expr(cd.adbin, cd.adrelid) IS DISTINCT FROM pg_get_expr(pd.adbin, pd.adrelid)
                ORDER BY a.attnum", [$rel['partitionOf'], $rel['oid']]),
        );
    }

    /**
     * Constraints that must wait for the rows: NOT VALID checks / NOT NULLs (rows may break them) and foreign keys
     * (the referenced rows may come later).
     *
     * @param  Relation  $rel
     * @return list<string>
     */
    public static function postDataConstraints(Connection $db, array $rel, bool $foreign): array
    {
        $out = [];
        foreach (self::constraints($db, $rel['oid']) as $c) {
            $fk = $c['type'] === 'f';
            if ($fk === $foreign && ($fk || (! self::inCreateTable($c) && in_array($c['type'], ['c', 'n'], true)))) {
                $out[] = 'ALTER TABLE '.self::qualified($rel['schema'], $rel['name']).' ADD CONSTRAINT '.self::quote($c['name']).' '.$c['definition'];
            }
        }

        return $out;
    }

    /**
     * @param  Relation  $rel
     * @return list<string> foreign keys, after the data
     */
    public static function foreignKeys(Connection $db, array $rel): array
    {
        return self::postDataConstraints($db, $rel, true);
    }

    /**
     * Indexes that don't back a constraint, and aren't a partition's copy of its parent's index (that copy comes
     * with the parent's index, which is created on the whole partition tree rather than ON ONLY the parent).
     *
     * @param  Relation  $rel
     * @return list<string>
     */
    public static function indexes(Connection $db, array $rel): array
    {
        return array_map(
            fn (array $r) => (string) preg_replace('/^(CREATE (?:UNIQUE )?INDEX (?:"(?:[^"]|"")*"|\S+) ON )ONLY /', '$1', (string) $r['definition'], 1),
            self::rows($db, "SELECT pg_get_indexdef(x.indexrelid) AS definition FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
                WHERE x.indrelid = ?
                  AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid AND con.conrelid = x.indrelid
                      AND con.contype IN ('p', 'u', 'x'))
                  AND NOT EXISTS (SELECT 1 FROM pg_inherits inh WHERE inh.inhrelid = x.indexrelid)
                ORDER BY i.relname", [$rel['oid']]),
        );
    }

    /**
     * COMMENT ON for a table or view, its columns, and (tables) its constraints and indexes.
     *
     * @param  Relation|array{oid: int, schema: string, name: string, comment: ?string}  $rel
     * @return list<string>
     */
    public static function comments(Connection $db, array $rel, bool $view = false): array
    {
        $name = self::qualified($rel['schema'], $rel['name']);
        $out = [];
        if ($rel['comment'] !== null) {
            $out[] = 'COMMENT ON '.($view ? 'VIEW ' : 'TABLE ').$name.' IS '.Literals::postgres($rel['comment'], false);
        }
        foreach (self::rows($db, 'SELECT a.attname AS name, col_description(a.attrelid, a.attnum) AS comment FROM pg_attribute a
            WHERE a.attrelid = ? AND a.attnum > 0 AND NOT a.attisdropped AND col_description(a.attrelid, a.attnum) IS NOT NULL
            ORDER BY a.attnum', [$rel['oid']]) as $c) {
            $out[] = 'COMMENT ON COLUMN '.$name.'.'.self::quote((string) $c['name']).' IS '.Literals::postgres((string) $c['comment'], false);
        }

        return $out;
    }

    /**
     * Comments on constraints and indexes, which exist only once the indexes and foreign keys are made.
     *
     * @param  Relation  $rel
     * @return list<string>
     */
    public static function keyComments(Connection $db, array $rel): array
    {
        $out = [];
        foreach (self::rows($db, "SELECT con.conname AS name, obj_description(con.oid, 'pg_constraint') AS comment FROM pg_constraint con
            WHERE con.conrelid = ? AND con.conislocal AND con.conparentid = 0 AND obj_description(con.oid, 'pg_constraint') IS NOT NULL
            ORDER BY con.conname", [$rel['oid']]) as $c) {
            $out[] = 'COMMENT ON CONSTRAINT '.self::quote((string) $c['name']).' ON '.self::qualified($rel['schema'], $rel['name'])
                .' IS '.Literals::postgres((string) $c['comment'], false);
        }
        foreach (self::rows($db, "SELECT i.relname AS name, obj_description(i.oid, 'pg_class') AS comment FROM pg_index x
            JOIN pg_class i ON i.oid = x.indexrelid
            WHERE x.indrelid = ? AND obj_description(i.oid, 'pg_class') IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid AND con.conrelid = x.indrelid
                  AND con.contype IN ('p', 'u', 'x'))
              AND NOT EXISTS (SELECT 1 FROM pg_inherits inh WHERE inh.inhrelid = x.indexrelid)
            ORDER BY i.relname", [$rel['oid']]) as $i) {
            $out[] = 'COMMENT ON INDEX '.self::qualified($rel['schema'], (string) $i['name']).' IS '.Literals::postgres((string) $i['comment'], false);
        }

        return $out;
    }

    /**
     * setval for the backup's sequences and the identity sequences of its tables, with is_called exactly.
     *
     * @param  list<Sequence>  $sequences
     * @param  list<Relation>  $relations
     * @return list<string>
     */
    public static function setvals(Connection $db, array $sequences, array $relations): array
    {
        $names = array_map(fn (array $s) => [$s['schema'], $s['name']], $sequences);
        if ($relations !== []) {
            foreach (self::rows($db, "SELECT DISTINCT n.nspname AS schema, c.relname AS name FROM pg_depend d
                JOIN pg_class c ON c.oid = d.objid JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype = 'i'
                  AND c.relkind = 'S' AND d.refobjid = ANY(?::oid[])
                ORDER BY 1, 2", [self::oids($relations)]) as $r) {
                $names[] = [(string) $r['schema'], (string) $r['name']];
            }
        }

        $out = [];
        foreach ($names as [$schema, $name]) {
            $state = self::rows($db, 'SELECT last_value::text AS last_value, is_called FROM '.self::qualified($schema, $name))[0]
                ?? throw new RuntimeException("Sequence {$schema}.{$name} has no state");
            $out[] = 'SELECT pg_catalog.setval('.Literals::postgres(self::qualified($schema, $name), false).', '
                .self::integer($state['last_value']).', '.((bool) $state['is_called'] ? 'true' : 'false').')';
        }

        return $out;
    }

    /**
     * CREATE VIEW for the chosen views (never extension members), each after the views it reads (pg_depend through
     * the view's rewrite rule), with their options (check_option, security_barrier) and comments.
     *
     * @param  list<DumpObject>  $views
     * @return list<string>
     */
    public static function views(Connection $db, array $views): array
    {
        $chosen = array_flip(array_map(fn (DumpObject $v) => ($v->schema ?? 'public')."\0".$v->name, $views));
        $defs = [];
        foreach (self::rows($db, "SELECT c.oid, n.nspname AS schema, c.relname AS name, pg_get_viewdef(c.oid) AS definition,
                array_to_json(c.reloptions)::text AS options, obj_description(c.oid, 'pg_class') AS comment
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'v' AND ".self::USER_SCHEMA.' AND NOT '.self::EXTENSION_MEMBER.'
            ORDER BY n.nspname, c.relname') as $r) {
            if (isset($chosen[$r['schema']."\0".$r['name']])) {
                $defs[(int) $r['oid']] = $r;
            }
        }
        if ($defs === []) {
            return [];
        }

        $deps = [];
        foreach (self::rows($db, "SELECT DISTINCT r.ev_class AS view, d.refobjid AS uses FROM pg_rewrite r
            JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid AND d.refclassid = 'pg_class'::regclass
            WHERE r.ev_class = ANY(?::oid[]) AND d.refobjid <> r.ev_class", ['{'.implode(',', array_keys($defs)).'}']) as $d) {
            $deps[(int) $d['view']][] = (int) $d['uses'];
        }

        $ordered = [];
        $state = [];
        $visit = function (int $oid) use (&$visit, &$ordered, &$state, $defs, $deps): void {
            if (isset($state[$oid])) {
                return;
            }
            $state[$oid] = true;
            foreach ($deps[$oid] ?? [] as $uses) {
                if (isset($defs[$uses])) {
                    $visit($uses);
                }
            }
            $ordered[] = $oid;
        };
        foreach (array_keys($defs) as $oid) {
            $visit($oid);
        }

        $out = [];
        foreach ($ordered as $oid) {
            $r = $defs[$oid];
            $view = ['oid' => $oid, 'schema' => (string) $r['schema'], 'name' => (string) $r['name'], 'comment' => self::nullableString($r['comment'])];
            $out[] = 'CREATE VIEW '.self::qualified($view['schema'], $view['name']).self::withOptions(self::stringList($r['options']))
                .' AS '.rtrim(trim((string) $r['definition']), ';');
            array_push($out, ...self::comments($db, $view, view: true));
        }

        return $out;
    }

    /**
     * Local constraints of a table (a partition's copies of its parent's come with PARTITION OF).
     *
     * @return list<array{name: string, type: string, validated: bool, definition: string}>
     */
    private static function constraints(Connection $db, int $oid): array
    {
        return array_map(fn (array $r) => [
            'name' => (string) $r['name'],
            'type' => (string) $r['type'],
            'validated' => (bool) $r['validated'],
            'definition' => (string) $r['definition'],
        ], self::rows($db, "SELECT con.conname AS name, con.contype::text AS type, con.convalidated AS validated,
                pg_get_constraintdef(con.oid) AS definition
            FROM pg_constraint con
            WHERE con.conrelid = ? AND con.conislocal AND con.conparentid = 0 AND con.contype IN ('n', 'p', 'u', 'c', 'x', 'f')
            ORDER BY CASE con.contype WHEN 'n' THEN 0 WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'x' THEN 3 ELSE 4 END, con.conname", [$oid]));
    }

    /** @param array{type: string, validated: bool} $c */
    private static function inCreateTable(array $c): bool
    {
        return in_array($c['type'], ['p', 'u', 'x'], true) || (in_array($c['type'], ['c', 'n'], true) && $c['validated']);
    }

    /** @param Column $c */
    private static function columnDefinition(Connection $db, int $table, array $c, int $version): string
    {
        $sql = self::quote($c['name']).' '.$c['type'];
        if ($c['collation'] !== null) {
            $sql .= ' COLLATE '.$c['collation'];
        }
        if ($c['generated'] !== '') {
            $sql .= ' GENERATED ALWAYS AS ('.$c['default_expr'].')'.($c['generated'] === 'v' ? ' VIRTUAL' : ' STORED');
        } elseif ($c['default_expr'] !== null) {
            $sql .= ' DEFAULT '.$c['default_expr'];
        }
        if ($c['identity'] !== '') {
            $sql .= ' GENERATED '.($c['identity'] === 'a' ? 'ALWAYS' : 'BY DEFAULT').' AS IDENTITY ('.self::identityOptions($db, $table, $c['attnum']).')';
        }
        // From PostgreSQL 18, NOT NULL is a named constraint of its own (written with the others).
        if ($c['not_null'] && $version < 180000) {
            $sql .= ' NOT NULL';
        }

        return $sql;
    }

    private static function identityOptions(Connection $db, int $table, int $attnum): string
    {
        $r = self::rows($db, "SELECT n.nspname AS schema, c.relname AS name, s.seqstart::text AS start, s.seqincrement::text AS increment,
                s.seqmin::text AS min, s.seqmax::text AS max, s.seqcache::text AS cache, s.seqcycle AS cycle
            FROM pg_depend d JOIN pg_class c ON c.oid = d.objid JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_sequence s ON s.seqrelid = c.oid
            WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype = 'i'
              AND d.refobjid = ? AND d.refobjsubid = ?", [$table, $attnum])[0] ?? null;
        if ($r === null) {
            return '';
        }

        return 'SEQUENCE NAME '.self::qualified((string) $r['schema'], (string) $r['name']).' '.self::sequenceOptions([
            'start' => self::integer($r['start']), 'increment' => self::integer($r['increment']), 'min' => self::integer($r['min']),
            'max' => self::integer($r['max']), 'cache' => self::integer($r['cache']), 'cycle' => (bool) $r['cycle'],
        ]);
    }

    /** @param array{start: string, increment: string, min: string, max: string, cache: string, cycle: bool} $s */
    private static function sequenceOptions(array $s): string
    {
        return "INCREMENT BY {$s['increment']} MINVALUE {$s['min']} MAXVALUE {$s['max']} START WITH {$s['start']} CACHE {$s['cache']}"
            .($s['cycle'] ? ' CYCLE' : ' NO CYCLE');
    }

    /** @param list<string> $options reloptions as name=value */
    private static function withOptions(array $options): string
    {
        if ($options === []) {
            return '';
        }

        return ' WITH ('.implode(', ', array_map(function (string $o) {
            [$name, $value] = array_pad(explode('=', $o, 2), 2, '');

            return self::quote($name).' = '.Literals::postgres($value, false);
        }, $options)).')';
    }

    /** @param list<array{oid: int}> $relations */
    private static function oids(array $relations): string
    {
        return '{'.implode(',', array_column($relations, 'oid')).'}';
    }

    /** A bigint read as text, checked before it goes into the SQL bare. */
    private static function integer(mixed $v): string
    {
        $s = is_scalar($v) ? (string) $v : '';
        if (preg_match('/^-?\d+$/', $s) !== 1) {
            throw new RuntimeException('Expected an integer from the catalog');
        }

        return $s;
    }

    /** @return list<string> */
    private static function stringList(mixed $json): array
    {
        if (! is_string($json) || $json === '') {
            return [];
        }
        $list = json_decode($json, true);

        return is_array($list) ? array_values(array_map(fn ($v) => is_scalar($v) ? (string) $v : '', $list)) : [];
    }

    private static function nullableString(mixed $v): ?string
    {
        return $v === null ? null : (is_scalar($v) ? (string) $v : null);
    }

    private static function value(Connection $db, string $sql): mixed
    {
        $row = self::rows($db, $sql)[0] ?? [];

        return array_values($row)[0] ?? null;
    }

    /**
     * On the raw PDO: Laravel would reconnect after a lost connection, onto a session without the snapshot.
     *
     * @param  list<mixed>  $params
     * @return list<array<string, mixed>>
     */
    private static function rows(Connection $db, string $sql, array $params = []): array
    {
        $stmt = $db->getPdo()->prepare($sql);
        $stmt->execute($params);

        /** @var list<array<string, mixed>> */
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}
