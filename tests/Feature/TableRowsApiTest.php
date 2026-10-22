<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use Illuminate\Support\Facades\DB;
use Tests\Support\Engines;

beforeEach(function () {
    $this->user = User::factory()->create();
    $path = Engines::sqlitePath();
    $db = DB::connectUsing('fixture', ['driver' => 'sqlite', 'database' => $path, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
    CommerceSchema::create($db);
    $db->table('audit_log')->update(['payload' => str_repeat('x', 5000)]);
    DB::purge('fixture');
    $this->connection = SavedConnection::factory()->for($this->user)->create([
        'driver' => DriverName::Sqlite, 'host' => null, 'port' => null, 'database' => $path, 'username' => null, 'password' => null,
    ]);
});

afterEach(fn () => Engines::resetSqlite());

it('filters, sorts and paginates with bound parameters', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'orders']), [
        'filters' => [['column' => 'status', 'op' => 'eq', 'value' => 'paid']],
        'sort' => ['column' => 'id', 'direction' => 'desc'],
    ])->assertOk();

    expect($res->json('rows'))->toHaveCount(1)
        ->and($res->json('columns.*.name'))->toBe(['id', 'user_id', 'status', 'created_at'])
        ->and($res->json('has_more'))->toBeFalse()
        ->and($res->json('sql'))->toContain("'paid'");
});

it('supports every operator', function (array $filter, int $expected) {
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['filters' => [$filter]])
        ->assertOk()->assertJsonCount($expected, 'rows');
})->with([
    [['column' => 'id', 'op' => 'eq', 'value' => '1'], 1],
    [['column' => 'id', 'op' => 'neq', 'value' => '1'], 2],
    [['column' => 'id', 'op' => 'lt', 'value' => '2'], 1],
    [['column' => 'id', 'op' => 'lte', 'value' => '2'], 2],
    [['column' => 'id', 'op' => 'gt', 'value' => '2'], 1],
    [['column' => 'id', 'op' => 'gte', 'value' => '2'], 2],
    [['column' => 'name', 'op' => 'contains', 'value' => 'an'], 1],
    [['column' => 'email', 'op' => 'starts_with', 'value' => 'ad'], 1],
    [['column' => 'email', 'op' => 'ends_with', 'value' => 'example.com'], 3],
    [['column' => 'profile', 'op' => 'is_null'], 1],
    [['column' => 'profile', 'op' => 'is_not_null'], 2],
    [['column' => 'name', 'op' => 'contains', 'value' => '%'], 0],
    [['column' => 'name', 'op' => 'contains', 'value' => '!'], 0],
]);

it('paginates with has_more', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['per_page' => 2, 'page' => 1])->assertOk();
    expect($res->json('rows'))->toHaveCount(2)->and($res->json('has_more'))->toBeTrue();
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['per_page' => 2, 'page' => 2])
        ->assertJsonCount(1, 'rows')->assertJsonPath('has_more', false);
});

it('rejects unknown columns and tables', function () {
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['filters' => [['column' => 'nope', 'op' => 'eq', 'value' => '1']]])
        ->assertUnprocessable()->assertJsonValidationErrors('filters.0.column');
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['sort' => ['column' => 'id; drop', 'direction' => 'asc']])
        ->assertUnprocessable();
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'nope']))->assertNotFound();
});

it('bounds long text cells to the result cap', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'audit_log']))->assertOk();

    expect($res->json('rows.0.1'))->toBe(str_repeat('x', 4000).'…');
});

it('keeps the sample endpoint cell cap unchanged', function () {
    $res = $this->actingAs($this->user)->getJson(route('api.tables.sample', [$this->connection, 'audit_log']))->assertOk();

    expect($res->json('rows.0.1'))->toBe(str_repeat('x', 200).'…');
});

it('returns a user-facing sql with raw columns, literal values and the page limit', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'orders']), [
        'filters' => [['column' => 'status', 'op' => 'eq', 'value' => "pa'id"]],
        'sort' => ['column' => 'id', 'direction' => 'desc'],
        'per_page' => 10, 'page' => 3,
    ])->assertOk();

    $sql = $res->json('sql');
    expect($sql)->toContain("\"status\" = 'pa''id'")
        ->and($sql)->toContain('order by "id" desc')
        ->and($sql)->toContain('limit 10 offset 20')
        ->and($sql)->not->toContain('substr')
        ->and($sql)->not->toContain('?');
});

it('orders by the primary key when no sort is given', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']))->assertOk();

    expect($res->json('sql'))->toContain('order by "id" asc')
        ->and(array_column($res->json('rows'), 0))->toBe([1, 2, 3]);
});

function fixtureRows(string $sql): array
{
    $pdo = new PDO('sqlite:'.Engines::sqlitePath());

    return array_map('array_values', $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC));
}

it('returns runnable display sql for quotes and placeholders in identifiers and values', function () {
    $pdo = new PDO('sqlite:'.Engines::sqlitePath());
    $pdo->exec('CREATE TABLE "weird" ("id" integer primary key, "a?b" text, "c""d" text)');
    $pdo->exec("INSERT INTO \"weird\" VALUES (1, 'x', 'p'), (2, 'y\"z', 'q'), (3, 'w".chr(92)."', 'r')");

    foreach ([
        ['column' => 'a?b', 'op' => 'eq', 'value' => 'x'],
        ['column' => 'a?b', 'op' => 'eq', 'value' => 'y"z'],
        ['column' => 'a?b', 'op' => 'contains', 'value' => '"'],
        ['column' => 'a?b', 'op' => 'ends_with', 'value' => chr(92)],
        ['column' => 'c"d', 'op' => 'neq', 'value' => "it's ?"],
    ] as $filter) {
        $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'weird']), ['filters' => [$filter]])->assertOk();

        expect($res->json('rows'))->not->toBeEmpty()
            ->and(fixtureRows($res->json('sql')))->toBe($res->json('rows'));
    }
});

it('rejects comparison operators without a value instead of failing in the database', function (string $op, mixed $value) {
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['filters' => [['column' => 'id', 'op' => $op, 'value' => $value]]])
        ->assertUnprocessable()->assertJsonValidationErrors('filters.0.value');
})->with([
    ['eq', ''], ['neq', null], ['lt', ''], ['lte', ''], ['gt', null], ['gte', ''],
]);

it('still accepts an empty value for pattern and null operators, and 0 for comparisons', function () {
    foreach ([['contains', ''], ['starts_with', null], ['is_null', null], ['eq', '0']] as [$op, $value]) {
        $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['filters' => [['column' => 'id', 'op' => $op, 'value' => $value]]])->assertOk();
    }
});

it('matches contains, starts_with and ends_with case-insensitively', function (string $op, string $value) {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['filters' => [['column' => 'name', 'op' => $op, 'value' => $value]]])->assertOk();

    expect($res->json('rows'))->toHaveCount(1)->and($res->json('rows.0.2'))->toBe('Ada Lovelace');
})->with([['contains', 'ADA'], ['contains', 'lOvE'], ['starts_with', 'ada'], ['ends_with', 'LACE']]);

it('rejects NUL bytes in filter values', function () {
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['filters' => [['column' => 'name', 'op' => 'eq', 'value' => "a\0b"]]])
        ->assertUnprocessable()->assertJsonValidationErrors('filters.0.value');
});

it('appends the primary key as a sort tiebreaker', function () {
    $sql = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['sort' => ['column' => 'name', 'direction' => 'desc']])
        ->assertOk()->json('sql');
    expect($sql)->toContain('order by "name" desc, "id" asc');

    $sql = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['sort' => ['column' => 'id', 'direction' => 'desc']])
        ->assertOk()->json('sql');
    expect($sql)->toContain('order by "id" desc')->and($sql)->not->toContain('"id" desc, "id"');
});

it('forbids reading rows of another user\'s connection', function () {
    $this->actingAs(User::factory()->create())->postJson(route('api.tables.rows', [$this->connection, 'users']), [])->assertForbidden();
});

it('sorts by several keys in order', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'orders']), [
        'sort' => [['column' => 'status', 'direction' => 'asc'], ['column' => 'id', 'direction' => 'desc']],
    ])->assertOk();

    $rows = $res->json('rows');
    $pairs = array_map(fn ($r) => [$r[2], $r[0]], $rows);
    $expected = $pairs;
    usort($expected, fn ($a, $b) => [$a[0], -$a[1]] <=> [$b[0], -$b[1]]);
    expect($pairs)->toBe($expected)
        ->and($res->json('sql'))->toMatch('/ORDER BY "status" asc, "id" desc/i');
});

it('still accepts the single-object sort form', function () {
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), [
        'sort' => ['column' => 'id', 'direction' => 'desc'], 'per_page' => 1,
    ])->assertOk()->assertJsonPath('rows.0.0', 3);
});

it('rejects more than three sort keys, duplicate keys and unknown columns', function (array $sort) {
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['sort' => $sort])
        ->assertUnprocessable();
})->with([
    'four keys' => [[['column' => 'id', 'direction' => 'asc'], ['column' => 'name', 'direction' => 'asc'], ['column' => 'email', 'direction' => 'asc'], ['column' => 'profile', 'direction' => 'asc']]],
    'duplicate' => [[['column' => 'id', 'direction' => 'asc'], ['column' => 'id', 'direction' => 'desc']]],
    'unknown' => [[['column' => 'nope', 'direction' => 'asc']]],
    'bad direction' => [[['column' => 'id', 'direction' => 'up']]],
]);

it('accepts pages of up to 1000 rows', function () {
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['per_page' => 1000])->assertOk();
    $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), ['per_page' => 1001])->assertUnprocessable();
});

// The SQL editor's matcher (match-table-query.ts) refuses padded values because of this.
it('trims filter values and nulls whitespace-only ones before building the query', function () {
    $post = fn (string $op, string $value) => $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']), [
        'filters' => [['column' => 'name', 'op' => $op, 'value' => $value]],
    ])->assertOk()->json('sql');

    expect($post('contains', ' '))->toContain("'%%'")->not->toContain("'% %'")
        ->and($post('eq', ' x'))->toContain("= 'x'")->not->toContain("' x'")
        ->and($post('eq', "x\u{200B}"))->toContain("= 'x'")
        ->and($post('contains', "\u{FEFF}a b\u{180E}"))->toContain("'%a b%'");
});
