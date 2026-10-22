<?php

use App\Database\CellValue;
use App\Database\DriverRegistry;
use App\Database\Editing\BuiltStatement;
use App\Database\Editing\ChangeSetBuilder;
use App\Database\Editing\ChangeSetRejected;
use App\Database\Editing\EditMethod;
use App\Database\Editing\EditPlan;
use App\Enums\DriverName;
use Illuminate\Database\Connection;
use Tests\TestCase;

uses(TestCase::class);

function csCol(string $name, string $typeName = 'integer', bool $nullable = true): array
{
    return ['name' => $name, 'type' => $typeName, 'type_name' => $typeName, 'nullable' => $nullable, 'default' => null, 'auto_increment' => false, 'comment' => null];
}

function csTable(array $columns, string $kind = 'table', string $name = 'things'): array
{
    return ['name' => $name, 'kind' => $kind, 'columns' => $columns, 'primary_key' => [], 'indexes' => []];
}

/** A connection whose escape() quotes like a standard-conforming server: '' doubles a quote. */
function csDb(): Connection
{
    $db = Mockery::mock(Connection::class);
    $db->shouldReceive('escape')->andReturnUsing(fn (mixed $v) => match (true) {
        $v === null => 'null',
        is_int($v) || is_float($v) => (string) $v,
        default => "'".str_replace("'", "''", (string) $v)."'",
    });

    return $db;
}

/** @return list<BuiltStatement> */
function csBuild(string $driver, EditPlan $plan, array $table, array $changes): array
{
    return (new ChangeSetBuilder)->build($plan, $table, app(DriverRegistry::class)->for(DriverName::from($driver)), csDb(), $changes);
}

function csRejected(string $driver, EditPlan $plan, array $table, array $changes): ChangeSetRejected
{
    try {
        csBuild($driver, $plan, $table, $changes);
    } catch (ChangeSetRejected $e) {
        return $e;
    }

    throw new RuntimeException('The change set was not rejected.');
}

function pkPlan(array $keys = ['id'], array $readOnly = []): EditPlan
{
    return new EditPlan(EditMethod::PrimaryKey, $keys, null, $readOnly);
}

it('updates by primary key with an optimistic check on edited columns', function () {
    $table = csTable([csCol('id', 'integer', false), csCol('name', 'varchar'), csCol('note', 'text')]);
    [$s] = csBuild('pgsql', pkPlan(), $table, [
        ['op' => 'update', 'id' => ['key' => ['id' => 7]], 'original' => ['name' => "O'Hara", 'note' => null], 'values' => ['name' => 'Ada', 'note' => 'x']],
    ]);

    expect($s->index)->toBe(0)
        ->and($s->op)->toBe('update')
        ->and($s->sql)->toBe('UPDATE "things" SET "name" = ?, "note" = ? WHERE "id" = ? AND "name" = ? AND "note" IS NULL')
        ->and($s->bindings)->toBe(['Ada', 'x', '7', "O'Hara"])
        ->and($s->previewSql)->toBe("UPDATE \"things\" SET \"name\" = 'Ada', \"note\" = 'x' WHERE \"id\" = '7' AND \"name\" = 'O''Hara' AND \"note\" IS NULL")
        ->and($s->target)->toBe('id = 7');
});

it('leaves inexact columns and the key itself out of the optimistic check', function () {
    $table = csTable([csCol('id', 'int4', false), csCol('f', 'float8'), csCol('doc', 'json'), csCol('n', 'int4')]);
    [$s] = csBuild('pgsql', pkPlan(), $table, [
        ['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['id' => 1, 'f' => 1.5, 'doc' => '{}', 'n' => 3], 'values' => ['id' => '2', 'f' => '2.5', 'doc' => '[]', 'n' => '4']],
    ]);

    expect($s->sql)->toBe('UPDATE "things" SET "id" = ?, "f" = ?, "doc" = ?, "n" = ? WHERE "id" = ? AND "n" = ?')
        ->and($s->bindings)->toBe(['2', '2.5', '[]', '4', '1', '3']);
});

it('pins by a composite unique index and deletes without a value check', function () {
    $table = csTable([csCol('a', 'integer', false), csCol('b', 'text', false), csCol('c')]);
    $plan = new EditPlan(EditMethod::UniqueIndex, ['b', 'a']);
    [$s] = csBuild('sqlite', $plan, $table, [
        ['op' => 'delete', 'id' => ['key' => ['b' => 'x', 'a' => 2]], 'original' => ['a' => 2, 'b' => 'x', 'c' => 5]],
    ]);

    // SQLite keeps JSON integers as integers: a column without affinity would not equal the text '2'.
    expect($s->sql)->toBe('DELETE FROM "things" WHERE "b" = ? AND "a" = ?')
        ->and($s->bindings)->toBe(['x', 2])
        ->and($s->target)->toBe("b = 'x', a = 2");
});

it('pins SQLite rows by the first rowid alias no column hides', function () {
    $table = csTable([csCol('rowid', 'text'), csCol('name', 'text')]);
    [$s] = csBuild('sqlite', new EditPlan(EditMethod::SqliteRowid), $table, [
        ['op' => 'update', 'id' => ['rowid' => '12'], 'original' => ['name' => 'a'], 'values' => ['name' => 'b']],
    ]);

    expect($s->sql)->toBe('UPDATE "things" SET "name" = ? WHERE _rowid_ = ? AND "name" = ?')
        ->and($s->bindings)->toBe(['b', 12, 'a'])
        ->and($s->previewSql)->toBe("UPDATE \"things\" SET \"name\" = 'b' WHERE _rowid_ = 12 AND \"name\" = 'a'")
        ->and($s->target)->toBe('rowid 12');
});

it('pins PostgreSQL rows by ctid and xmin, checking only the written columns', function () {
    $table = csTable([csCol('note', 'text'), csCol('f', 'float8'), csCol('qty', 'int4'), csCol('j', 'json')]);
    [$s] = csBuild('pgsql', new EditPlan(EditMethod::PgCtid), $table, [
        ['op' => 'update', 'id' => ['ctid' => '(0,3)', 'xmin' => '7781'], 'original' => ['note' => 'a', 'f' => 1.5, 'qty' => null, 'j' => '{}'], 'values' => ['note' => 'b']],
    ]);

    expect($s->sql)->toBe('UPDATE "things" SET "note" = ? WHERE ctid = ?::tid AND xmin = ?::xid AND "note" = ?')
        ->and($s->bindings)->toBe(['b', '(0,3)', '7781', 'a'])
        ->and($s->previewSql)->toBe("UPDATE \"things\" SET \"note\" = 'b' WHERE ctid = '(0,3)'::tid AND xmin = '7781'::xid AND \"note\" = 'a'")
        ->and($s->target)->toBe('ctid (0,3)');
});

it('refuses ctid changes without xmin or without the originals they write', function (array $change, string $field) {
    $table = csTable([csCol('note', 'text'), csCol('f', 'float8'), csCol('qty', 'int4'), csCol('photo', 'bytea')]);

    expect(csRejected('pgsql', new EditPlan(EditMethod::PgCtid), $table, [$change])->field)->toBe($field);
})->with([
    'ctid only' => [['op' => 'delete', 'id' => ['ctid' => '(0,3)'], 'original' => ['note' => 'a', 'qty' => 1]], 'changes.0.id'],
    'bad xmin' => [['op' => 'delete', 'id' => ['ctid' => '(0,3)', 'xmin' => '1 or 1=1'], 'original' => ['note' => 'a', 'qty' => 1]], 'changes.0.id'],
    'a written original missing' => [['op' => 'update', 'id' => ['ctid' => '(0,3)', 'xmin' => '5'], 'original' => ['note' => 'a'], 'values' => ['note' => 'b', 'qty' => '2']], 'changes.0.original'],
]);

it('deletes a ctid row by ctid and xmin alone', function () {
    $table = csTable([csCol('note', 'text'), csCol('f', 'float8'), csCol('photo', 'bytea')]);
    [$s] = csBuild('pgsql', new EditPlan(EditMethod::PgCtid), $table, [['op' => 'delete', 'id' => ['ctid' => '(0,3)', 'xmin' => '5'], 'original' => ['note' => 'a']]]);

    expect($s->sql)->toBe('DELETE FROM "things" WHERE ctid = ?::tid AND xmin = ?::xid')
        ->and($s->bindings)->toBe(['(0,3)', '5']);
});

it('adds tableoid to the ctid when the table has children', function () {
    $table = csTable([csCol('v', 'text')]);
    $plan = new EditPlan(EditMethod::PgCtid, needsTableoid: true);
    [$s] = csBuild('pgsql', $plan, $table, [['op' => 'delete', 'id' => ['ctid' => '(0,1)', 'xmin' => '9', 'tableoid' => '16384'], 'original' => ['v' => 'a']]]);

    expect($s->sql)->toBe('DELETE FROM "things" WHERE tableoid = ?::oid AND ctid = ?::tid AND xmin = ?::xid')
        ->and($s->bindings)->toBe(['16384', '(0,1)', '9'])
        ->and($s->target)->toBe('ctid (0,1) in tableoid 16384');

    expect(csRejected('pgsql', $plan, $table, [['op' => 'delete', 'id' => ['ctid' => '(0,1)', 'xmin' => '9'], 'original' => ['v' => 'a']]])->field)->toBe('changes.0.id');
});

it('matches every MySQL/MariaDB column null-safely, text byte for byte, one row at most', function (string $driver) {
    $table = csTable([csCol('name', 'varchar'), csCol('code', 'char'), csCol('kind', 'enum'), csCol('qty', 'int'), csCol('at', 'datetime'), csCol('gone', 'text')]);
    [$s] = csBuild($driver, new EditPlan(EditMethod::MysqlAllValues), $table, [
        ['op' => 'update', 'id' => ['values' => ['name' => 'a ', 'code' => 'ab', 'kind' => 'x', 'qty' => 1, 'at' => '2026-01-01 00:00:00', 'gone' => null]], 'original' => ['qty' => 1], 'values' => ['qty' => '2']],
    ]);

    $bin = fn (string $c) => "CAST(CONVERT(`{$c}` USING utf8mb4) AS BINARY) <=> CAST(? AS BINARY)";
    expect($s->sql)->toBe('UPDATE `things` SET `qty` = ? WHERE '.$bin('name').' AND '.$bin('code').' AND '.$bin('kind').' AND `qty` <=> ? AND `at` <=> ? AND '.$bin('gone').' LIMIT 1')
        ->and($s->bindings)->toBe(['2', 'a ', 'ab', 'x', '1', '2026-01-01 00:00:00', null])
        ->and($s->previewSql)->toEndWith("`at` <=> '2026-01-01 00:00:00' AND CAST(CONVERT(`gone` USING utf8mb4) AS BINARY) <=> CAST(null AS BINARY) LIMIT 1")
        ->and($s->target)->toBe('matched by all values');

    [$d] = csBuild($driver, new EditPlan(EditMethod::MysqlAllValues), $table, [
        ['op' => 'delete', 'id' => ['values' => ['name' => 'a', 'code' => 'b', 'kind' => 'x', 'qty' => 1, 'at' => null, 'gone' => null]]],
    ]);
    expect($d->sql)->toStartWith('DELETE FROM `things` WHERE ')->toEndWith(' LIMIT 1');
})->with(['mysql', 'mariadb']);

it('compares MySQL text exactly in the optimistic check too', function () {
    $table = csTable([csCol('id', 'int', false), csCol('name', 'varchar')]);
    [$s] = csBuild('mysql', pkPlan(), $table, [['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['name' => 'A'], 'values' => ['name' => 'b']]]);

    expect($s->sql)->toBe('UPDATE `things` SET `name` = ? WHERE `id` = ? AND CAST(CONVERT(`name` USING utf8mb4) AS BINARY) = CAST(? AS BINARY)');
});

it('refuses an all-values row when a column cannot be compared exactly', function () {
    $table = csTable([csCol('f', 'double'), csCol('n', 'int')]);
    $e = csRejected('mysql', new EditPlan(EditMethod::MysqlAllValues), $table, [['op' => 'delete', 'id' => ['values' => ['f' => 1.5, 'n' => 1]]]]);

    expect($e->field)->toBe('changes.0.id')->and($e->getMessage())->toContain("can't be pinned");
});

it('treats MySQL TIMESTAMP as not exactly comparable', function () {
    $table = csTable([csCol('at', 'timestamp'), csCol('n', 'int')]);
    $e = csRejected('mariadb', new EditPlan(EditMethod::MysqlAllValues), $table, [['op' => 'delete', 'id' => ['values' => ['at' => '2026-11-01 01:30:00', 'n' => 1]]]]);

    expect($e->field)->toBe('changes.0.id');
});

it('inserts only the columns given, or a row of defaults', function (string $driver, string $empty) {
    $table = csTable([csCol('id', 'integer', false), csCol('name', 'text'), csCol('note', 'text')]);
    $plan = pkPlan();
    [$a, $b] = csBuild($driver, $plan, $table, [
        ['op' => 'insert', 'values' => ['name' => 'Ada', 'note' => null]],
        ['op' => 'insert', 'values' => []],
    ]);
    $q = $driver === 'mysql' ? '`' : '"';

    expect($a->sql)->toBe("INSERT INTO {$q}things{$q} ({$q}name{$q}, {$q}note{$q}) VALUES (?, ?)")
        ->and($a->bindings)->toBe(['Ada', null])
        ->and($a->previewSql)->toBe("INSERT INTO {$q}things{$q} ({$q}name{$q}, {$q}note{$q}) VALUES ('Ada', null)")
        ->and($a->target)->toBe('new row')
        ->and($b->sql)->toBe($empty);
})->with([
    ['sqlite', 'INSERT INTO "things" DEFAULT VALUES'],
    ['pgsql', 'INSERT INTO "things" DEFAULT VALUES'],
    ['mysql', 'INSERT INTO `things` () VALUES ()'],
]);

it('converts JSON booleans per engine', function (string $driver, string $true, string $false) {
    $table = csTable([csCol('id', 'integer', false), csCol('on', 'tinyint'), csCol('off', 'tinyint')]);
    [$s] = csBuild($driver, pkPlan(), $table, [['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['on' => false, 'off' => true], 'values' => ['on' => true, 'off' => false]]]);

    expect(array_slice($s->bindings, 0, 2))->toBe([$true, $false])
        ->and(array_slice($s->bindings, -2))->toBe([$false, $true]);
})->with([['sqlite', '1', '0'], ['mysql', '1', '0'], ['mariadb', '1', '0'], ['pgsql', 'true', 'false']]);

it('orders deletes, then updates, then inserts, keeping request order within each', function () {
    $table = csTable([csCol('id', 'integer', false), csCol('name', 'text')]);
    $built = csBuild('sqlite', pkPlan(), $table, [
        ['op' => 'insert', 'values' => ['id' => '1']],
        ['op' => 'update', 'id' => ['key' => ['id' => 2]], 'original' => ['name' => 'a'], 'values' => ['name' => 'b']],
        ['op' => 'delete', 'id' => ['key' => ['id' => 1]]],
        ['op' => 'insert', 'values' => ['id' => '3']],
        ['op' => 'delete', 'id' => ['key' => ['id' => 4]]],
    ]);

    expect(array_map(fn (BuiltStatement $s) => [$s->index, $s->op], $built))
        ->toBe([[2, 'delete'], [4, 'delete'], [1, 'update'], [0, 'insert'], [3, 'insert']]);
});

it('rejects changes the grid would not allow', function (array $change, string $field, string $message) {
    $table = csTable([csCol('id', 'integer', false), csCol('name', 'text'), csCol('total'), csCol('photo', 'blob')]);
    $e = csRejected('sqlite', pkPlan(['id'], ['total', 'photo']), $table, [$change]);

    expect($e->field)->toBe($field)->and($e->getMessage())->toContain($message);
})->with([
    'unknown column' => [['op' => 'insert', 'values' => ['nope' => '1']], 'changes.0.values', 'Unknown column "nope"'],
    'read-only column' => [['op' => 'insert', 'values' => ['total' => '1']], 'changes.0.values', '"total" can\'t be edited'],
    'binary column' => [['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['photo' => null], 'values' => ['photo' => 'x']], 'changes.0.values', '"photo" can\'t be edited'],
    'update without identity' => [['op' => 'update', 'original' => ['name' => 'a'], 'values' => ['name' => 'b']], 'changes.0.id', 'identity'],
    'delete without identity' => [['op' => 'delete'], 'changes.0.id', 'identity'],
    'wrong identity shape' => [['op' => 'delete', 'id' => ['rowid' => '1']], 'changes.0.id', 'identity'],
    'missing key column' => [['op' => 'delete', 'id' => ['key' => []]], 'changes.0.id', 'identity'],
    'extra key column' => [['op' => 'delete', 'id' => ['key' => ['id' => 1, 'name' => 'a']]], 'changes.0.id', 'identity'],
    'null key' => [['op' => 'delete', 'id' => ['key' => ['id' => null]]], 'changes.0.id', 'identity'],
    'update without values' => [['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => [], 'values' => []], 'changes.0.values', 'Nothing to update'],
    'missing original' => [['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => [], 'values' => ['name' => 'b']], 'changes.0.original', '"name"'],
    'unknown original column' => [['op' => 'delete', 'id' => ['key' => ['id' => 1]], 'original' => ['nope' => 1]], 'changes.0.original', 'Unknown column "nope"'],
    'shortened original' => [['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['name' => str_repeat('x', CellValue::RESULT_CHARS).'…'], 'values' => ['name' => 'b']], 'changes.0.original', 'shortened'],
    'number as value' => [['op' => 'insert', 'values' => ['name' => 5]], 'changes.0.values', 'text or null'],
    'too long value' => [['op' => 'insert', 'values' => ['name' => str_repeat('x', 1_000_001)]], 'changes.0.values', '1,000,000'],
    'NUL in value' => [['op' => 'insert', 'values' => ['name' => "a\0b"]], 'changes.0.values', 'NUL'],
    'unknown op' => [['op' => 'upsert'], 'changes.0.op', 'insert, update or delete'],
]);

it('accepts a long new value for a column whose original was shown whole', function () {
    $table = csTable([csCol('id', 'integer', false), csCol('name', 'text')]);
    [$s] = csBuild('sqlite', pkPlan(), $table, [['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['name' => str_repeat('x', CellValue::RESULT_CHARS)], 'values' => ['name' => str_repeat('y', 5000)]]]);

    expect($s->bindings[0])->toHaveLength(5000);
});

it('rejects all-values identities that were shortened or do not cover every column', function (array $values) {
    $table = csTable([csCol('note', 'text'), csCol('n', 'int')]);
    $e = csRejected('mysql', new EditPlan(EditMethod::MysqlAllValues), $table, [['op' => 'delete', 'id' => ['values' => $values]]]);

    expect($e->field)->toBe('changes.0.id');
})->with([
    'shortened' => [['note' => str_repeat('x', CellValue::RESULT_CHARS + 1), 'n' => 1]],
    'missing column' => [['note' => 'a']],
    'extra column' => [['note' => 'a', 'n' => 1, 'x' => 2]],
]);

it('rejects bad rowid and ctid identities', function (string $driver, EditPlan $plan, array $id) {
    expect(csRejected($driver, $plan, csTable([csCol('v', 'text')]), [['op' => 'delete', 'id' => $id]])->field)->toBe('changes.0.id');
})->with([
    ['sqlite', new EditPlan(EditMethod::SqliteRowid), ['rowid' => '1; drop']],
    ['sqlite', new EditPlan(EditMethod::SqliteRowid), ['rowid' => null]],
    'rowid above the 64-bit range' => ['sqlite', new EditPlan(EditMethod::SqliteRowid), ['rowid' => '9223372036854775808']],
    'rowid below the 64-bit range' => ['sqlite', new EditPlan(EditMethod::SqliteRowid), ['rowid' => '-9223372036854775809']],
    ['sqlite', new EditPlan(EditMethod::SqliteRowid), ['rowid' => '1.5']],
    ['pgsql', new EditPlan(EditMethod::PgCtid), ['ctid' => "(0,1)'", 'xmin' => '1']],
    ['pgsql', new EditPlan(EditMethod::PgCtid), ['ctid' => '(0,1)', 'xmin' => '1', 'tableoid' => '1']],
    ['pgsql', new EditPlan(EditMethod::PgCtid, needsTableoid: true), ['ctid' => '(0,1)', 'xmin' => '1', 'tableoid' => 'x']],
]);

it('keeps the 64-bit rowid limits exact', function () {
    [$s] = csBuild('sqlite', new EditPlan(EditMethod::SqliteRowid), csTable([csCol('v', 'text')]), [['op' => 'delete', 'id' => ['rowid' => '-9223372036854775808']]]);

    expect($s->bindings)->toBe([PHP_INT_MIN])->and($s->target)->toBe('rowid -9223372036854775808');
});

it('inserts into inexact columns of a key-less MySQL table: inserts match nothing', function () {
    $table = csTable([csCol('f', 'float'), csCol('n', 'int')]);
    [$s] = csBuild('mysql', new EditPlan(EditMethod::MysqlAllValues), $table, [['op' => 'insert', 'values' => ['f' => '1.5', 'n' => '1']]]);

    expect($s->sql)->toBe('INSERT INTO `things` (`f`, `n`) VALUES (?, ?)');
});

it('binds SQLite numeric originals as numbers', function () {
    $table = csTable([csCol('id', 'integer', false), csCol('r', 'real'), csCol('u', ''), csCol('note', 'text')]);
    [$s] = csBuild('sqlite', pkPlan(), $table, [['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['u' => 0.1, 'note' => 'a'], 'values' => ['u' => '2', 'note' => 'b']]]);

    expect($s->bindings)->toBe(['2', 'b', 1, 0.1, 'a'])
        ->and($s->previewSql)->toContain('"u" = 0.1');
});

it('caps the total size of a change set', function () {
    $table = csTable([csCol('id', 'integer', false), csCol('name', 'text')]);
    $big = ['op' => 'insert', 'values' => ['name' => str_repeat('x', 900_000)]];
    $e = csRejected('sqlite', pkPlan(), $table, array_fill(0, 12, $big));

    expect($e->field)->toBe('changes')->and($e->getMessage())->toContain('10,000,000');
});

it('refuses tables that cannot be edited and views', function () {
    $table = csTable([csCol('id')]);
    $e = csRejected('sqlite', EditPlan::none('this table has no primary key or unique index to identify rows'), $table, [['op' => 'insert', 'values' => ['id' => '1']]]);
    expect($e->field)->toBe('changes')->and($e->getMessage())->toContain('no primary key');

    $e = csRejected('sqlite', pkPlan(), csTable([csCol('id')], 'view'), [['op' => 'insert', 'values' => ['id' => '1']]]);
    expect($e->getMessage())->toContain("views can't be edited");
});

it('quotes awkward identifiers through the driver', function () {
    $table = csTable([csCol('id', 'integer', false), csCol('we"ird', 'text')], name: 'a"b');
    [$s] = csBuild('pgsql', pkPlan(), $table, [['op' => 'insert', 'values' => ['we"ird' => 'x']]]);

    expect($s->sql)->toBe('INSERT INTO "a""b" ("we""ird") VALUES (?)');
});
