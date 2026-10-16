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
    DB::purge('fixture');
    $this->connection = SavedConnection::factory()->for($this->user)->create([
        'driver' => DriverName::Sqlite, 'host' => null, 'port' => null, 'database' => $path, 'username' => null, 'password' => null,
    ]);
    $this->relId = function (string $from, string $to) {
        $rels = $this->actingAs($this->user)->getJson(route('api.schema.show', $this->connection))->json('snapshot.relationships');

        return collect($rels)->first(fn ($r) => $r['from_table'] === $from && $r['to_table'] === $to)['id'];
    };
    $this->related = fn (string $table, array $key, string $rel, string $dir, array $extra = []) => $this->actingAs($this->user)->getJson(
        route('api.records.related', [$this->connection, $table, 'key' => json_encode($key), 'rel' => $rel, 'dir' => $dir, ...$extra])
    );
    $this->write = function (callable $fn) {
        $w = DB::connectUsing('w', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
        $fn($w);
        DB::purge('w');
    };
    $this->refresh = fn () => $this->actingAs($this->user)->postJson(route('api.schema.refresh', $this->connection))->assertOk();
});

afterEach(fn () => Engines::resetSqlite());

it('returns the parent for an outgoing relationship', function () {
    $res = ($this->related)('orders', ['id' => 1], ($this->relId)('orders', 'users'), 'out')->assertOk();

    expect($res->json('table'))->toBe('users')
        ->and($res->json('rows'))->toHaveCount(1)
        ->and($res->json('rows.0.key'))->toBe(['id' => 2])
        ->and($res->json('next_cursor'))->toBeNull();
});

it('returns children ordered by primary key with keyset paging', function () {
    $rel = ($this->relId)('order_items', 'orders');
    $first = ($this->related)('orders', ['id' => 1], $rel, 'in', ['limit' => 1])->assertOk();
    expect($first->json('rows.0.key'))->toBe(['id' => 1])->and($first->json('next_cursor'))->not->toBeNull();

    $second = ($this->related)('orders', ['id' => 1], $rel, 'in', ['limit' => 1, 'cursor' => $first->json('next_cursor')])->assertOk();
    expect($second->json('rows.0.key'))->toBe(['id' => 2])->and($second->json('next_cursor'))->toBeNull();
});

it('pages composite child keys without repeats or gaps', function () {
    ($this->write)(fn ($w) => $w->table('product_tags')->insert([['product_id' => 1, 'tag' => 'a'], ['product_id' => 1, 'tag' => 'z'], ['product_id' => 1, 'tag' => "o'q %"]]));
    $rel = ($this->relId)('product_tags', 'products');

    $seen = [];
    $cursor = null;
    do {
        $res = ($this->related)('products', ['id' => 1], $rel, 'in', ['limit' => 2, ...($cursor ? ['cursor' => $cursor] : [])])->assertOk();
        foreach ($res->json('rows') as $r) {
            $seen[] = $r['key']['tag'];
        }
        $cursor = $res->json('next_cursor');
    } while ($cursor);

    expect($seen)->toBe(['a', 'bestseller', "o'q %", 'rgb', 'z']);
});

it('follows a self-referential relationship in both directions', function () {
    $rel = ($this->relId)('categories', 'categories');
    ($this->related)('categories', ['id' => 2], $rel, 'out')->assertOk()->assertJsonPath('rows.0.key', ['id' => 1]);
    ($this->related)('categories', ['id' => 1], $rel, 'in')->assertOk()->assertJsonPath('rows.0.key', ['id' => 2]);
});

it('validates rel, dir, limit and cursor', function () {
    $rel = ($this->relId)('orders', 'users');
    ($this->related)('orders', ['id' => 1], 'nope', 'out')->assertUnprocessable()->assertJsonValidationErrors('rel');
    ($this->related)('orders', ['id' => 1], $rel, 'in')->assertUnprocessable()->assertJsonValidationErrors('rel'); // orders is the from side
    ($this->related)('orders', ['id' => 1], $rel, 'sideways')->assertUnprocessable()->assertJsonValidationErrors('dir');
    ($this->related)('orders', ['id' => 1], $rel, 'out', ['limit' => 101])->assertUnprocessable()->assertJsonValidationErrors('limit');
    ($this->related)('users', ['id' => 2], $rel, 'in', ['cursor' => 'garbage'])->assertUnprocessable()->assertJsonValidationErrors('cursor');
    ($this->related)('users', ['id' => 2], $rel, 'in', ['cursor' => str_repeat('a', 12001)])->assertUnprocessable()->assertJsonValidationErrors('cursor');
    ($this->related)('orders', ['id' => 1], str_repeat('r', 2049), 'out')->assertUnprocessable()->assertJsonValidationErrors('rel');
});

it('accepts relationship ids up to 2,048 characters', function () {
    // A long id passes validation and is then rejected only because no relationship has it.
    ($this->related)('orders', ['id' => 1], str_repeat('r', 2048), 'out')->assertUnprocessable()
        ->assertJsonValidationErrors(['rel' => 'Unknown relationship for this table and direction.']);
});

it('rejects cursors with the wrong arity or value types', function (array $payload) {
    $rel = ($this->relId)('orders', 'users');
    $cursor = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
    ($this->related)('users', ['id' => 2], $rel, 'in', ['cursor' => $cursor])->assertUnprocessable()->assertJsonValidationErrors('cursor');
})->with([
    'too many values' => [[1, 2]],
    'empty' => [[]],
    'object' => [['id' => 1]],
    'nested' => [[[1]]],
    'null' => [[null]],
    'bool' => [[true]],
]);

it('returns an empty parent when the foreign key is null', function () {
    ($this->related)('categories', ['id' => 1], ($this->relId)('categories', 'categories'), 'out')->assertOk()->assertJsonCount(0, 'rows');
});

it('returns 404 record_missing when the source record does not exist', function () {
    ($this->related)('orders', ['id' => 999], ($this->relId)('orders', 'users'), 'out')->assertNotFound()->assertJsonPath('error.reason', 'record_missing');
});

it('refuses targets without a primary key', function () {
    ($this->write)(fn ($w) => $w->statement('create table user_notes (user_id integer references users(id), note text)'));
    ($this->refresh)();

    ($this->related)('users', ['id' => 1], ($this->relId)('user_notes', 'users'), 'in')->assertUnprocessable()->assertJsonPath('error.reason', 'no_primary_key');
});

it('refuses targets with a binary primary key using the binary message', function () {
    ($this->write)(function ($w) {
        $w->statement('create table blob_parents (id blob primary key)');
        $w->statement('create table blob_kids (id integer primary key, parent_id blob references blob_parents(id))');
    });
    ($this->refresh)();

    ($this->related)('blob_kids', ['id' => 1], ($this->relId)('blob_kids', 'blob_parents'), 'out')->assertUnprocessable()
        ->assertJsonPath('error.reason', 'no_primary_key')
        ->assertJsonPath('error.message', 'blob_parents has a binary primary key; open it in the Data tab instead.');
});

it('refuses targets with a floating-point primary key', function () {
    ($this->write)(function ($w) {
        $w->statement('create table real_parents (id real primary key)');
        $w->statement('create table real_kids (id integer primary key, parent_id real references real_parents(id))');
    });
    ($this->refresh)();

    ($this->related)('real_kids', ['id' => 1], ($this->relId)('real_kids', 'real_parents'), 'out')->assertUnprocessable()
        ->assertJsonPath('error.reason', 'no_primary_key')
        ->assertJsonPath('error.message', 'real_parents has a floating-point primary key; open it in the Data tab instead.');
});

it('refuses a view as the source', function () {
    $rel = ($this->relId)('orders', 'users');
    ($this->related)('order_totals', ['id' => 1], $rel, 'out')->assertUnprocessable()->assertJsonPath('error.reason', 'no_primary_key');
});

it('forbids other users', function () {
    $rel = ($this->relId)('orders', 'users');
    $this->actingAs(User::factory()->create())->getJson(route('api.records.related', [$this->connection, 'orders', 'key' => '{"id":1}', 'rel' => $rel, 'dir' => 'out']))->assertForbidden();
});

it('still resolves a table literally named related through records.show', function () {
    ($this->write)(function ($w) {
        $w->statement('create table related (id integer primary key, label text)');
        $w->table('related')->insert(['id' => 1, 'label' => 'x']);
    });
    ($this->refresh)();

    $this->actingAs($this->user)->getJson(route('api.records.show', [$this->connection, 'related', 'key' => '{"id":1}']))
        ->assertOk()->assertJsonPath('table', 'related')->assertJsonPath('key', ['id' => 1]);
});

it('matches and pages on raw long string keys and returns raw keys', function () {
    $long = str_repeat('k', 4500);
    ($this->write)(function ($w) use ($long) {
        $w->statement('CREATE TABLE docs (code TEXT PRIMARY KEY, label TEXT)');
        $w->statement('CREATE TABLE doc_notes (code TEXT PRIMARY KEY, doc_code TEXT REFERENCES docs(code), note TEXT)');
        $w->table('docs')->insert(['code' => $long, 'label' => 'x']);
        $w->table('doc_notes')->insert([['code' => $long.'1', 'doc_code' => $long, 'note' => 'a'], ['code' => $long.'2', 'doc_code' => $long, 'note' => 'b'], ['code' => $long.'3', 'doc_code' => $long, 'note' => 'c']]);
    });
    ($this->refresh)();
    $rel = ($this->relId)('doc_notes', 'docs');

    $seen = [];
    $cursor = null;
    do {
        $res = ($this->related)('docs', ['code' => $long], $rel, 'in', ['limit' => 2, ...($cursor ? ['cursor' => $cursor] : [])])->assertOk();
        foreach ($res->json('rows') as $r) {
            $seen[] = $r['key']['code'];
        }
        $cursor = $res->json('next_cursor');
    } while ($cursor);
    expect($seen)->toBe([$long.'1', $long.'2', $long.'3']);

    $out = ($this->related)('doc_notes', ['code' => $long.'2'], $rel, 'out')->assertOk();
    expect($out->json('rows.0.key'))->toBe(['code' => $long]);
});

it('keeps displayed values bounded', function () {
    ($this->write)(fn ($w) => $w->table('users')->where('id', 2)->update(['name' => str_repeat('é', 5000)]));
    $res = ($this->related)('orders', ['id' => 1], ($this->relId)('orders', 'users'), 'out')->assertOk();
    $values = array_combine($res->json('columns.*.name'), $res->json('rows.0.values'));

    expect(mb_strlen($values['name']))->toBeLessThan(5000);
});

it('works when the target has a column named like the internal raw alias', function () {
    ($this->write)(function ($w) {
        $w->statement('CREATE TABLE odd_parent (id INTEGER PRIMARY KEY)');
        $w->statement('CREATE TABLE odd_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES odd_parent(id), "__r0" TEXT, "__r1" TEXT)');
        $w->table('odd_parent')->insert(['id' => 1]);
        $w->table('odd_child')->insert(['id' => 5, 'parent_id' => 1, '__r0' => 'zero', '__r1' => 'one']);
    });
    ($this->refresh)();

    ($this->related)('odd_parent', ['id' => 1], ($this->relId)('odd_child', 'odd_parent'), 'in')->assertOk()
        ->assertJsonPath('rows.0.key', ['id' => 5])->assertJsonPath('rows.0.values', [5, 1, 'zero', 'one']);
});
