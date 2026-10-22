<?php

use App\Database\Editing\ColumnComparability;
use App\Database\Editing\EditMethod;
use App\Database\Editing\EditMethodResolver;
use App\Database\Editing\EditPlan;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Tests\TestCase;

uses(TestCase::class);

function editCol(string $name, string $typeName = 'integer', bool $nullable = false): array
{
    return ['name' => $name, 'type' => $typeName, 'type_name' => $typeName, 'nullable' => $nullable, 'default' => null, 'auto_increment' => false, 'comment' => null];
}

function editTable(array $columns, array $pk = [], array $indexes = [], string $kind = 'table'): array
{
    return ['name' => 'things', 'kind' => $kind, 'columns' => $columns, 'primary_key' => $pk, 'indexes' => $indexes];
}

function uniqueIndex(string $name, array $columns): array
{
    return ['name' => $name, 'columns' => $columns, 'unique' => true, 'primary' => false];
}

/** A connection that answers every catalog query with no rows, except the given SQL fragments. */
function catalogDb(array $answers = []): Connection
{
    $db = Mockery::mock(Connection::class);
    $db->shouldReceive('getDatabaseName')->andReturn('shop');
    $db->shouldReceive('getServerVersion')->andReturn('17.0');
    $db->shouldReceive('select')->andReturnUsing(function (string $sql) use ($answers) {
        foreach ($answers as $fragment => $rows) {
            if (str_contains($sql, $fragment)) {
                return array_map(fn (array $r) => (object) $r, $rows);
            }
        }

        return [];
    });

    return $db;
}

function resolvedPlan(string $driver, array $table, array $answers = [], bool $readOnly = false): EditPlan
{
    $saved = new SavedConnection(['driver' => DriverName::from($driver), 'read_only' => $readOnly, 'options' => []]);

    return (new EditMethodResolver)->resolve($saved, $table, catalogDb($answers));
}

it('refuses views', function (string $driver) {
    $plan = resolvedPlan($driver, editTable([editCol('id')], ['id'], kind: 'view'));

    expect($plan->method)->toBe(EditMethod::None)
        ->and($plan->reason)->toBe("views can't be edited")
        ->and($plan->keyColumns)->toBe([]);
})->with(['sqlite', 'mysql', 'mariadb', 'pgsql']);

it('refuses read-only connections', function () {
    $plan = resolvedPlan('pgsql', editTable([editCol('id')], ['id']), readOnly: true);

    expect($plan->method)->toBe(EditMethod::None)
        ->and($plan->reason)->toBe('this connection is read-only');
});

it('pins rows by primary key', function (string $driver) {
    $plan = resolvedPlan($driver, editTable([editCol('a'), editCol('b'), editCol('c', 'text', true)], ['b', 'a'], [uniqueIndex('u', ['c'])]));

    expect($plan->method)->toBe(EditMethod::PrimaryKey)
        ->and($plan->keyColumns)->toBe(['b', 'a'])
        ->and($plan->reason)->toBeNull();
})->with(['sqlite', 'mysql', 'mariadb', 'pgsql']);

it('uses the first unique index (by name) whose columns are all NOT NULL', function (string $driver) {
    $plan = resolvedPlan($driver, editTable(
        [editCol('a'), editCol('b'), editCol('c', 'text', true)],
        indexes: [
            uniqueIndex('z_ab', ['a', 'b']),
            uniqueIndex('a_c', ['c']),
            ['name' => 'b_plain', 'columns' => ['b'], 'unique' => false, 'primary' => false],
            uniqueIndex('m_b', ['b']),
        ],
    ));

    expect($plan->method)->toBe(EditMethod::UniqueIndex)
        ->and($plan->keyColumns)->toBe(['b']);
})->with(['sqlite', 'mysql', 'mariadb', 'pgsql']);

it('does not use a unique index with a nullable column', function () {
    $plan = resolvedPlan('mysql', editTable([editCol('a'), editCol('b', 'int', true)], indexes: [uniqueIndex('ab', ['a', 'b'])]));

    expect($plan->method)->toBe(EditMethod::MysqlAllValues)
        ->and($plan->keyColumns)->toBe([]);
});

it('does not use a unique index on an expression or a missing column', function () {
    $plan = resolvedPlan('pgsql', editTable([editCol('a')], indexes: [uniqueIndex('expr', ['a', '']), uniqueIndex('gone', ['nope'])]));

    expect($plan->method)->toBe(EditMethod::PgCtid);
});

it('does not use a partial, expression, invalid or deferrable unique index', function (string $driver, string $fragment, array $row, string $method) {
    $plan = resolvedPlan($driver, editTable([editCol('a')], indexes: [uniqueIndex('partial_a', ['a'])]), [$fragment => [$row]]);

    expect($plan->method)->toBe(EditMethod::from($method));
})->with([
    ['pgsql', 'indisvalid', ['name' => 'partial_a'], 'pg_ctid'],
    ['sqlite', 'pragma_index_list', ['name' => 'partial_a'], 'sqlite_rowid'],
    ['mysql', 'information_schema.statistics', ['INDEX_NAME' => 'partial_a', 'COLUMN_NAME' => null], 'mysql_all_values'],
    ['mysql', 'information_schema.statistics', ['INDEX_NAME' => 'partial_a', 'COLUMN_NAME' => 'a', 'EXPRESSION' => 'lower(`b`)'], 'mysql_all_values'],
]);

it('keeps a MySQL/MariaDB unique index whose key parts are all plain columns', function () {
    $plan = resolvedPlan('mariadb', editTable([editCol('a')], indexes: [uniqueIndex('a', ['a'])]), ['information_schema.statistics' => [['INDEX_NAME' => 'a', 'COLUMN_NAME' => 'a']]]);

    expect($plan->method)->toBe(EditMethod::UniqueIndex);
});

it('flags PostgreSQL ctid tables that need tableoid', function (array $rows, bool $needs) {
    $plan = resolvedPlan('pgsql', editTable([editCol('a')]), ['pg_inherits' => $rows]);

    expect($plan->method)->toBe(EditMethod::PgCtid)
        ->and($plan->needsTableoid)->toBe($needs)
        ->and($plan->toArray()['needs_tableoid'])->toBe($needs);
})->with([[[['needs' => true]], true], [[['needs' => false]], false], [[], false]]);

it('never flags tableoid for other methods', function () {
    expect(resolvedPlan('pgsql', editTable([editCol('a')], ['a']), ['pg_inherits' => [['needs' => true]]])->needsTableoid)->toBeFalse()
        ->and(resolvedPlan('mysql', editTable([editCol('a')]))->needsTableoid)->toBeFalse();
});

it('falls back to the SQLite rowid for ordinary rowid tables', function () {
    $plan = resolvedPlan('sqlite', editTable([editCol('a', 'text', true)]), ['sqlite_master' => [['sql' => 'CREATE TABLE things (a text)']]]);

    expect($plan->method)->toBe(EditMethod::SqliteRowid)
        ->and($plan->keyColumns)->toBe([]);
});

it('refuses a SQLite table whose rowid aliases are all shadowed by columns', function () {
    $plan = resolvedPlan('sqlite', editTable([editCol('rowid'), editCol('_ROWID_'), editCol('oid')]), ['sqlite_master' => [['sql' => 'CREATE TABLE things (rowid, _ROWID_, oid)']]]);

    expect($plan->method)->toBe(EditMethod::None)
        ->and($plan->reason)->not->toBeNull();
});

it('refuses a SQLite WITHOUT ROWID table without a key', function () {
    $plan = resolvedPlan('sqlite', editTable([editCol('a')]), ['sqlite_master' => [['sql' => 'CREATE TABLE things (a int) WITHOUT ROWID']]]);

    expect($plan->method)->toBe(EditMethod::None);
});

it('falls back to ctid on PostgreSQL and to all values on MySQL/MariaDB', function (string $driver, string $method) {
    $plan = resolvedPlan($driver, editTable([editCol('a', 'text', true)]));

    expect($plan->method)->toBe(EditMethod::from($method))
        ->and($plan->keyColumns)->toBe([]);
})->with([['pgsql', 'pg_ctid'], ['mysql', 'mysql_all_values'], ['mariadb', 'mysql_all_values']]);

it('lists generated, identity-always and binary columns as read-only', function (string $driver, string $fragment) {
    $plan = resolvedPlan($driver, editTable([editCol('id'), editCol('total'), editCol('photo', 'blob', true)], ['id']), [$fragment => [['name' => 'total']]]);

    expect($plan->readOnlyColumns)->toBe(['total', 'photo']);
})->with([['sqlite', 'pragma_table_xinfo'], ['mysql', 'information_schema.columns'], ['mariadb', 'information_schema.columns'], ['pgsql', 'attgenerated']]);

it('compares only exactly comparable columns', function (string $driver, string $typeName, bool $exact) {
    expect(ColumnComparability::exact(DriverName::from($driver), editCol('c', $typeName)))->toBe($exact);
})->with([
    ['pgsql', 'int4', true],
    ['pgsql', 'text', true],
    ['pgsql', 'numeric', true],
    ['pgsql', 'jsonb', true],
    ['pgsql', 'timestamptz', true],
    ['pgsql', 'float8', false],
    ['pgsql', 'float4', false],
    ['pgsql', 'json', false],
    ['pgsql', 'xml', false],
    ['pgsql', 'point', false],
    ['pgsql', 'polygon', false],
    ['pgsql', 'bytea', false],
    ['pgsql', '_json', false],
    ['mysql', 'int', true],
    ['mysql', 'bigint', true],
    ['mysql', 'decimal', true],
    ['mysql', 'datetime', true],
    ['mysql', 'varchar', true],
    ['mysql', 'longtext', true],
    ['mysql', 'double', false],
    ['mysql', 'float', false],
    ['mysql', 'json', false],
    ['mysql', 'varbinary', false],
    ['mysql', 'blob', false],
    ['mysql', 'geometry', false],
    ['mariadb', 'bit', false],
    ['sqlite', 'integer', true],
    ['sqlite', 'text', true],
    ['sqlite', 'real', false],
    ['sqlite', 'blob', false],
]);
