<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
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

it('keeps the user-facing sql and columns byte-identical with identities added', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'orders']), [
        'filters' => [['column' => 'status', 'op' => 'eq', 'value' => "pa'id"]],
        'sort' => ['column' => 'id', 'direction' => 'desc'],
        'per_page' => 10, 'page' => 3,
    ])->assertOk();
    expect($res->json('sql'))->toBe(<<<'SQL'
        select "id", "user_id", "status", "created_at" from "orders" where "status" = 'pa''id' order by "id" desc limit 10 offset 20
        SQL)
        ->and(json_encode($res->json('columns')))->toBe('[{"name":"id","type":"integer","table":"orders"},{"name":"user_id","type":"integer","table":"orders"},{"name":"status","type":"varchar","table":"orders"},{"name":"created_at","type":"datetime","table":"orders"}]');

    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']))->assertOk();
    expect($res->json('sql'))->toBe('select "id", "group_id", "name", "email", "profile", "avatar", "created_at" from "users" order by "id" asc limit 100 offset 0')
        ->and($res->json('rows'))->toBe([
            [1, 1, 'Ada Lovelace', 'ada@example.com', '{"plan":"pro"}', null, '2026-10-01 12:00:00'],
            [2, 2, 'Alan Turing', 'alan@example.com', null, null, '2026-10-01 12:00:00'],
            [3, 2, 'Grace Hopper', 'grace@example.com', '{"plan":"free"}', null, '2026-10-01 12:00:00'],
        ]);
});

it('pins primary-key rows by their key and locks binary columns', function () {
    $pdo = new PDO('sqlite:'.Engines::sqlitePath());
    $pdo->exec("UPDATE users SET avatar = X'00FF10' WHERE id = 2");

    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']))->assertOk();

    expect($res->json('editing'))->toBe(['method' => 'primary_key', 'reason' => null, 'read_only_columns' => ['avatar']])
        ->and($res->json('row_ids'))->toBe([['key' => ['id' => 1]], ['key' => ['id' => 2]], ['key' => ['id' => 3]]])
        ->and($res->json('locked'))->toBe([[5], [5], [5]])
        // Only the cell whose shown value isn't the stored one counts as shortened; a NULL binary cell is shown whole.
        ->and($res->json('shortened'))->toBe([[], [5], []])
        ->and($res->json('rows.1.5'))->toBe('[binary 3 bytes]')
        ->and($res->json('columns'))->toHaveCount(7)
        ->and($res->json('rows.0'))->toHaveCount(7);
});

it('returns exact key values even when the shown value is shortened', function () {
    $pdo = new PDO('sqlite:'.Engines::sqlitePath());
    $long = str_repeat('k', 4999).'é';
    $pdo->exec('CREATE TABLE "longkey" ("code" text primary key, "big" integer, "note" text)');
    $pdo->prepare('INSERT INTO "longkey" VALUES (?, 1, ?), (?, 2, ?)')->execute([$long, str_repeat('n', 5000), 'short', 'fine']);
    $pdo->exec('CREATE TABLE "bigkey" ("id" integer primary key, "note" text)');
    $pdo->exec("INSERT INTO \"bigkey\" VALUES (9007199254740993, 'x'), (-9007199254740993, 'y'), (7, 'z')");

    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'longkey']))->assertOk();
    expect($res->json('editing.method'))->toBe('primary_key')
        ->and($res->json('row_ids.0.key.code'))->toBe($long)
        ->and($res->json('rows.0.0'))->toBe(str_repeat('k', 4000).'…')
        ->and($res->json('locked'))->toBe([[0, 2], []])
        ->and($res->json('shortened'))->toBe([[0, 2], []])
        ->and($res->json('row_ids.1'))->toBe(['key' => ['code' => 'short']]);

    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'bigkey']))->assertOk();
    expect($res->json('row_ids'))->toBe([
        ['key' => ['id' => '-9007199254740993']],
        ['key' => ['id' => 7]],
        ['key' => ['id' => '9007199254740993']],
    ]);
});

it('pins rows of a table without a key by SQLite rowid and locks shortened text', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'audit_log']))->assertOk();

    expect($res->json('editing'))->toBe(['method' => 'sqlite_rowid', 'reason' => null, 'read_only_columns' => []])
        ->and($res->json('row_ids.0'))->toBe(['rowid' => '1'])
        ->and($res->json('locked.0'))->toBe([1])
        ->and($res->json('rows.0'))->toHaveCount(count($res->json('columns')));
});

it('locks SQLite cells holding a BLOB in a text column, and never pins a row by one', function () {
    $pdo = new PDO('sqlite:'.Engines::sqlitePath());
    $pdo->exec('CREATE TABLE "mixed" ("id" integer primary key, "note" text, "other" text)');
    $pdo->exec("INSERT INTO \"mixed\" VALUES (1, x'616263', 'ok'), (2, 'abc', x'00ff'), (3, 'plain', NULL)");
    $pdo->exec('CREATE TABLE "blobkey" ("code" text primary key, "note" text)');
    $pdo->exec("INSERT INTO \"blobkey\" VALUES (x'6b31', 'a'), ('k2', 'b')");

    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'mixed']))->assertOk();
    expect($res->json('locked'))->toBe([[1], [2], []])
        ->and($res->json('shortened'))->toBe([[1], [2], []])
        ->and($res->json('row_ids.0'))->toBe(['key' => ['id' => 1]]);

    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'blobkey']))->assertOk();
    // SQLite sorts BLOBs after text.
    expect($res->json('row_ids'))->toBe([['key' => ['code' => 'k2']], null])
        ->and($res->json('locked.1'))->toBe([0]);
});

it('uses a rowid alias that no column shadows', function () {
    $pdo = new PDO('sqlite:'.Engines::sqlitePath());
    $pdo->exec('CREATE TABLE "shadow" ("rowid" text, "__dbzuper_rowid" text)');
    $pdo->exec("INSERT INTO \"shadow\" VALUES ('user value', 'mine')");

    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'shadow']))->assertOk();

    expect($res->json('editing.method'))->toBe('sqlite_rowid')
        ->and($res->json('row_ids'))->toBe([['rowid' => '1']])
        ->and($res->json('rows'))->toBe([['user value', 'mine']])
        ->and($res->json('columns.*.name'))->toBe(['rowid', '__dbzuper_rowid']);
});

it('marks views as not editable with a reason', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'order_totals']))->assertOk();

    expect($res->json('editing'))->toBe(['method' => 'none', 'reason' => "views can't be edited", 'read_only_columns' => []])
        ->and($res->json('row_ids'))->toBe(array_fill(0, count($res->json('rows')), null))
        ->and($res->json('locked'))->toHaveCount(count($res->json('rows')))
        ->and($res->json('shortened'))->toHaveCount(count($res->json('rows')));
});

it('marks rows of a read-only connection as not editable', function () {
    $this->connection->update(['read_only' => true]);

    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']))->assertOk();

    expect($res->json('editing.method'))->toBe('none')
        ->and($res->json('editing.reason'))->toBe('this connection is read-only')
        ->and($res->json('row_ids'))->toBe([null, null, null]);
});

it('resolves the edit plan once per snapshot and follows read-only changes', function () {
    $lookups = 0;
    Event::listen(QueryExecuted::class, function (QueryExecuted $e) use (&$lookups) {
        $lookups += (int) str_contains($e->sql, 'where hidden in (2, 3)');
    });
    $post = fn () => $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'users']))->assertOk();

    $post()->assertJsonPath('editing.method', 'primary_key');
    $post()->assertJsonPath('editing.method', 'primary_key');
    expect($lookups)->toBe(1);

    $this->connection->update(['read_only' => true]);
    $post()->assertJsonPath('editing.method', 'none');
});

it('filters a DATETIME column by on, between and after', function (array $filter, array $ids) {
    $pdo = new PDO('sqlite:'.Engines::sqlitePath());
    $pdo->exec('CREATE TABLE "events" ("id" integer primary key, "at" DATETIME)');
    $pdo->exec("INSERT INTO \"events\" VALUES (1, '2026-10-01 00:00:00'), (2, '2026-10-15 23:59:59'), (3, '2026-10-16 00:00:00'), (4, '2026-10-31 12:00:00')");

    $res = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'events']), ['filters' => [$filter]])->assertOk();

    expect(array_column($res->json('rows'), 0))->toBe($ids)
        ->and(array_column(fixtureRows($res->json('sql')), 0))->toBe($ids);
    $this->actingAs($this->user)->postJson(route('api.tables.count', [$this->connection, 'events']), ['filters' => [$filter]])
        ->assertOk()->assertJsonPath('count', count($ids));
})->with([
    'between dates' => [['column' => 'at', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-15'], [1, 2]],
    'on' => [['column' => 'at', 'op' => 'on', 'value' => '2026-10-15'], [2]],
    'after a date' => [['column' => 'at', 'op' => 'after', 'value' => '2026-10-15'], [3, 4]],
    'between a date and a time' => [['column' => 'at', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-15 23:59:58'], [1]],
    'between a time and the same day' => [['column' => 'at', 'op' => 'between', 'value' => '2026-10-15 10:00:00', 'to' => '2026-10-15'], [2]],
]);

it('shows date filters in the display sql in the matcher\'s shapes', function (array $filter, string $where) {
    $pdo = new PDO('sqlite:'.Engines::sqlitePath());
    $pdo->exec('CREATE TABLE "events" ("id" integer primary key, "day" date, "at" DATETIME)');

    $sql = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'events']), ['filters' => [$filter]])->assertOk()->json('sql');

    expect($sql)->toContain(' where '.$where.' order by');
})->with([
    'on' => [['column' => 'at', 'op' => 'on', 'value' => '2026-10-15'], "\"at\" >= '2026-10-15' and \"at\" < '2026-10-16'"],
    'on a date' => [['column' => 'day', 'op' => 'on', 'value' => '2026-10-31'], "\"day\" >= '2026-10-31' and \"day\" < '2026-11-01'"],
    'between dates on a date' => [['column' => 'day', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-31'], "\"day\" BETWEEN '2026-10-01' AND '2026-10-31'"],
    'between dates on a datetime' => [['column' => 'at', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-12-31'], "\"at\" >= '2026-10-01' and \"at\" < '2027-01-01'"],
    'between timed' => [['column' => 'at', 'op' => 'between', 'value' => '2026-10-01 10:00:00', 'to' => '2026-10-02 11:00:00.5'], "\"at\" BETWEEN '2026-10-01 10:00:00' AND '2026-10-02 11:00:00.5'"],
    'between a time and a date' => [['column' => 'at', 'op' => 'between', 'value' => '2026-10-01 10:00:00', 'to' => '2026-10-02'], "\"at\" >= '2026-10-01 10:00:00' and \"at\" < '2026-10-03'"],
    'between a date and a time' => [['column' => 'at', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-02 11:00:00'], "\"at\" >= '2026-10-01' and \"at\" <= '2026-10-02 11:00:00'"],
    'after a date' => [['column' => 'day', 'op' => 'after', 'value' => '2028-02-28'], "\"day\" >= '2028-02-29'"],
    'after a time' => [['column' => 'at', 'op' => 'after', 'value' => '2026-10-01 10:00:00'], "\"at\" > '2026-10-01 10:00:00'"],
]);

it('rejects invalid date filters on the rows and count endpoints', function (array $filter, string $key) {
    foreach (['api.tables.rows', 'api.tables.count'] as $route) {
        $this->actingAs($this->user)->postJson(route($route, [$this->connection, 'users']), ['filters' => [$filter]])
            ->assertUnprocessable()->assertJsonValidationErrors($key);
    }
})->with([
    'text column' => [['column' => 'name', 'op' => 'on', 'value' => '2026-10-01'], 'filters.0.op'],
    'reversed range' => [['column' => 'created_at', 'op' => 'between', 'value' => '2026-10-15', 'to' => '2026-10-01'], 'filters.0.to'],
    'missing value' => [['column' => 'created_at', 'op' => 'after'], 'filters.0.value'],
    'impossible date' => [['column' => 'created_at', 'op' => 'on', 'value' => '2026-02-30'], 'filters.0.value'],
    'to on eq' => [['column' => 'name', 'op' => 'eq', 'value' => 'x', 'to' => '2026-10-01'], 'filters.0.to'],
]);
