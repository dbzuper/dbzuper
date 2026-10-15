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
    $this->show = fn (string $table, array|string $key) => $this->actingAs($this->user)->getJson(
        route('api.records.show', [$this->connection, $table, 'key' => is_string($key) ? $key : json_encode($key)])
    );
});

afterEach(fn () => Engines::resetSqlite());

it('reads a record with columns, values and relationship summary', function () {
    $res = ($this->show)('orders', ['id' => 1])->assertOk();

    expect($res->json('table'))->toBe('orders')
        ->and($res->json('key'))->toBe(['id' => 1])
        ->and($res->json('columns.*.name'))->toBe(['id', 'user_id', 'status', 'created_at'])
        ->and($res->json('values'))->toBe([1, 2, 'paid', '2026-10-01 12:00:00']);

    $rels = collect($res->json('relationships'));
    $toUser = $rels->firstWhere('table', 'users');
    expect($toUser)->toMatchArray(['direction' => 'out', 'columns' => ['user_id'], 'other_columns' => ['id'], 'inferred' => true, 'available' => true, 'count' => null]);
    $items = $rels->firstWhere('table', 'order_items');
    expect($items)->toMatchArray(['direction' => 'in', 'columns' => ['order_id'], 'other_columns' => ['id'], 'available' => true])
        ->and($items['count'])->toBe(['value' => 2, 'capped' => false]);
});

it('shows self-referential relationships in both directions', function () {
    $res = ($this->show)('categories', ['id' => 2])->assertOk();
    $dirs = collect($res->json('relationships'))->where('table', 'categories')->pluck('direction')->sort()->values()->all();

    expect($dirs)->toBe(['in', 'out']);
});

it('marks an outgoing relationship unavailable when the FK is null', function () {
    $res = ($this->show)('categories', ['id' => 1])->assertOk();
    $parent = collect($res->json('relationships'))->first(fn ($r) => $r['table'] === 'categories' && $r['direction'] === 'out');

    expect($parent['available'])->toBeFalse();
});

it('supports composite keys', function () {
    ($this->show)('product_tags', ['product_id' => 1, 'tag' => 'rgb'])->assertOk()->assertJsonPath('values.1', 'rgb');
    ($this->show)('product_tags', ['tag' => 'rgb', 'product_id' => 1])->assertOk(); // order-insensitive
});

it('rejects bad keys', function (string $table, string $key) {
    ($this->show)($table, $key)->assertUnprocessable()->assertJsonValidationErrors('key');
})->with([
    'not json' => ['orders', 'nope'],
    'missing column' => ['product_tags', '{"product_id":1}'],
    'extra column' => ['orders', '{"id":1,"status":"paid"}'],
    'non-pk column' => ['orders', '{"status":"paid"}'],
    'array value' => ['orders', '{"id":[1]}'],
    'null value' => ['orders', '{"id":null}'],
    'bool value' => ['orders', '{"id":true}'],
]);

it('returns 404 for a missing record or unknown table', function () {
    ($this->show)('orders', ['id' => 999])->assertNotFound()->assertJsonPath('error.reason', 'record_missing');
    ($this->show)('nope', ['id' => 1])->assertNotFound();
});

it('refuses tables without a primary key and views', function (string $table) {
    ($this->show)($table, ['id' => 1])->assertUnprocessable()->assertJsonPath('error.reason', 'no_primary_key');
})->with(['audit_log', 'order_totals']);

it('caps long values and shows binary sizes', function () {
    $w = DB::connectUsing('w', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => ''], force: true);
    $w->table('users')->where('id', 1)->update(['name' => str_repeat('é', 5000)]);
    // Bind as a real BLOB: a PDO string bind is stored as TEXT and length() would count characters.
    $stmt = $w->getPdo()->prepare('UPDATE users SET avatar = ? WHERE id = 1');
    $stmt->bindValue(1, random_bytes(16), PDO::PARAM_LOB);
    $stmt->execute();
    DB::purge('w');

    $res = ($this->show)('users', ['id' => 1])->assertOk();
    $values = array_combine($res->json('columns.*.name'), $res->json('values'));
    expect(mb_strlen($values['name']))->toBe(4001)->and($values['avatar'])->toBe('[binary 16 bytes]');
});

it('caps counts at 10,000+', function () {
    $w = DB::connectUsing('w', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => ''], force: true);
    $rows = [];
    for ($i = 0; $i < 10050; $i++) {
        $rows[] = ['order_id' => 1, 'product_id' => 1, 'quantity' => 1, 'unit_price' => '1.00'];
        if (count($rows) === 500) {
            $w->table('order_items')->insert($rows);
            $rows = [];
        }
    }
    $w->table('order_items')->insert($rows);
    DB::purge('w');

    $items = collect(($this->show)('orders', ['id' => 1])->assertOk()->json('relationships'))->firstWhere('table', 'order_items');
    expect($items['count'])->toBe(['value' => 10000, 'capped' => true]);
});

it('forbids other users', function () {
    $this->actingAs(User::factory()->create())->getJson(route('api.records.show', [$this->connection, 'orders', 'key' => '{"id":1}']))->assertForbidden();
});

it('refuses tables whose primary key is binary', function () {
    $w = DB::connectUsing('w', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => ''], force: true);
    $w->statement('CREATE TABLE blobs (id BLOB PRIMARY KEY, label TEXT)');
    DB::purge('w');

    ($this->show)('blobs', ['id' => 'x'])->assertUnprocessable()->assertJsonPath('error.reason', 'no_primary_key');
});

it('counts children and round-trips string keys that are long or contain special characters', function (string $code) {
    $w = DB::connectUsing('w', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
    $w->statement('CREATE TABLE docs (code TEXT PRIMARY KEY, label TEXT)');
    $w->statement('CREATE TABLE doc_notes (id INTEGER PRIMARY KEY, doc_code TEXT REFERENCES docs(code), note TEXT)');
    $w->table('docs')->insert(['code' => $code, 'label' => 'x']);
    $w->table('doc_notes')->insert([['doc_code' => $code, 'note' => 'a'], ['doc_code' => $code, 'note' => 'b'], ['doc_code' => $code, 'note' => 'c']]);
    DB::purge('w');

    $res = ($this->show)('docs', ['code' => $code])->assertOk();
    $notes = collect($res->json('relationships'))->firstWhere('table', 'doc_notes');

    expect($res->json('key'))->toBe(['code' => $code])
        ->and($notes['count'])->toBe(['value' => 3, 'capped' => false]);
})->with([
    'short' => ['abc'],
    '300 chars' => [str_repeat('k', 300)],
    '4500 chars' => [str_repeat('k', 4500)],
    'special' => ["O'Re\illy \"100%\" 🚀"],
]);

it('echoes the canonical key of the row, not the request values', function () {
    ($this->show)('orders', '{"id":"1"}')->assertOk()->assertJsonPath('key', ['id' => 1]);
});
