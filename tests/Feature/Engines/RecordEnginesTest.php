<?php

use App\Database\ConnectionFactory;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use Tests\Support\Engines;

it('reads records and counts relationships on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        $tricky = "O'Re".chr(92).'illy "100%" 🚀';
        if ($engine === 'pgsql') {
            $db->table('users')->insert(['id' => 100, 'name' => $tricky, 'email' => 'tricky@example.com']);
        }
        $factory->release($db);
        $show = fn (string $table, array $key) => $this->actingAs($saved->user)->getJson(route('api.records.show', [$saved, $table, 'key' => json_encode($key)]));

        $order = $show('orders', ['id' => 1])->assertOk();
        expect($order->json('values.2'))->toBe('paid');
        $items = collect($order->json('relationships'))->firstWhere('table', 'order_items');
        expect($items['count'])->toBe(['value' => 2, 'capped' => false]);

        $show('product_tags', ['product_id' => 1, 'tag' => 'rgb'])->assertOk();

        if ($engine === 'pgsql') {
            $user = $show('users', ['id' => 100])->assertOk();
            $values = array_combine($user->json('columns.*.name'), $user->json('values'));
            expect($values['name'])->toBe($tricky);
        }
    } finally {
        $db = $factory->make($saved);
        CommerceSchema::drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);

it('treats invalid or loosely matching keys on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        $big = '9007199254740993';
        $db->table('users')->insert(['id' => $big, 'name' => 'Big', 'email' => 'big@example.com']);
        $factory->release($db);
        $show = fn (string $table, string $key) => $this->actingAs($saved->user)->getJson(route('api.records.show', [$saved, $table, 'key' => $key]));

        // Big integers stay exact: the key is echoed as a string.
        $show('users', '{"id":"'.$big.'"}')->assertOk()->assertJsonPath('key', ['id' => $big]);
        // The echoed key is the row's, so the same record never has two identities.
        $show('orders', '{"id":"1"}')->assertOk()->assertJsonPath('key', ['id' => 1]);

        if ($engine === 'pgsql') {
            $show('orders', '{"id":"abc"}')->assertNotFound()->assertJsonPath('error.reason', 'record_missing');
            $show('orders', '{"id":"99999999999999999999"}')->assertNotFound()->assertJsonPath('error.reason', 'record_missing');
        } else {
            // MySQL coerces '1abc' to 1: either a 404 or the canonical key is acceptable, never the echoed request value.
            $res = $show('orders', '{"id":"1abc"}');
            expect($res->status())->toBeIn([200, 404]);
            if ($res->status() === 200) {
                expect($res->json('key'))->toBe(['id' => 1]);
            }
            // Case-insensitive collation: the key is the stored value.
            $show('product_tags', '{"product_id":1,"tag":"RGB"}')->assertOk()->assertJsonPath('key', ['product_id' => 1, 'tag' => 'rgb']);
        }
    } finally {
        $db = $factory->make($saved);
        CommerceSchema::drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);

it('keeps the record when a relationship count is out of range, and round-trips boolean keys, on pgsql', function () {
    Engines::skipUnlessAvailable('pgsql');
    $saved = Engines::savedConnection('pgsql');
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        $db->statement('DROP TABLE IF EXISTS rec_child');
        $db->statement('DROP TABLE IF EXISTS rec_parent');
        $db->statement('DROP TABLE IF EXISTS rec_flags');
        $db->statement('CREATE TABLE rec_parent (id BIGINT PRIMARY KEY)');
        $db->statement('CREATE TABLE rec_child (id INT PRIMARY KEY, parent_id INT REFERENCES rec_parent(id))');
        $db->statement('CREATE TABLE rec_flags (active BOOLEAN, n INT, PRIMARY KEY (active, n))');
        $db->statement('INSERT INTO rec_parent VALUES (3000000000)');
        $db->statement('INSERT INTO rec_flags VALUES (true, 1)');
        $factory->release($db);
        $show = fn (string $table, array $key) => $this->actingAs($saved->user)->getJson(route('api.records.show', [$saved, $table, 'key' => json_encode($key)]));

        $res = $show('rec_parent', ['id' => 3000000000])->assertOk();
        $child = collect($res->json('relationships'))->firstWhere('table', 'rec_child');
        expect($child['count'])->toBe(['value' => 0, 'capped' => false]);

        $flag = $show('rec_flags', ['active' => 'true', 'n' => 1])->assertOk();
        expect($flag->json('key'))->toBe(['active' => 'true', 'n' => 1]);
        $show('rec_flags', $flag->json('key'))->assertOk();
    } finally {
        $db = $factory->make($saved);
        $db->statement('DROP TABLE IF EXISTS rec_child');
        $db->statement('DROP TABLE IF EXISTS rec_parent');
        $db->statement('DROP TABLE IF EXISTS rec_flags');
        CommerceSchema::drop($db);
        $factory->release($db);
    }
});

it('pages composite child keys in the database order without repeats or gaps on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        $db->table('product_tags')->insert([['product_id' => 1, 'tag' => 'a'], ['product_id' => 1, 'tag' => 'z'], ['product_id' => 1, 'tag' => "o'q %"], ['product_id' => 1, 'tag' => 'B'], ['product_id' => 1, 'tag' => '_x']]);
        $expected = array_map(fn ($r) => $r->tag, $db->select('SELECT tag FROM product_tags WHERE product_id = 1 ORDER BY product_id, tag'));
        $factory->release($db);

        $rels = $this->actingAs($saved->user)->getJson(route('api.schema.show', $saved))->json('snapshot.relationships');
        $rel = collect($rels)->first(fn ($r) => $r['from_table'] === 'product_tags' && $r['to_table'] === 'products')['id'];

        foreach ([1, 2, 100] as $limit) {
            $seen = [];
            $cursor = null;
            do {
                $res = $this->actingAs($saved->user)->getJson(route('api.records.related', [$saved, 'products', 'key' => '{"id":1}', 'rel' => $rel, 'dir' => 'in', 'limit' => $limit, ...($cursor ? ['cursor' => $cursor] : [])]))->assertOk();
                foreach ($res->json('rows') as $r) {
                    $seen[] = $r['key']['tag'];
                }
                $cursor = $res->json('next_cursor');
            } while ($cursor);
            expect($seen)->toBe($expected);
        }
    } finally {
        $db = $factory->make($saved);
        CommerceSchema::drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);

it('treats out-of-range values as empty pages and keeps canonical keys on pgsql', function () {
    Engines::skipUnlessAvailable('pgsql');
    $saved = Engines::savedConnection('pgsql');
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        foreach (['rec_child', 'rec_parent', 'rec_flag_kids', 'rec_flags'] as $t) {
            $db->statement("DROP TABLE IF EXISTS {$t}");
        }
        $db->statement('CREATE TABLE rec_parent (id BIGINT PRIMARY KEY)');
        $db->statement('CREATE TABLE rec_child (id INT PRIMARY KEY, parent_id INT REFERENCES rec_parent(id))');
        $db->statement('CREATE TABLE rec_flags (active BOOLEAN, n INT, PRIMARY KEY (active, n))');
        $db->statement('CREATE TABLE rec_flag_kids (id INT PRIMARY KEY, active BOOLEAN, n INT, FOREIGN KEY (active, n) REFERENCES rec_flags(active, n))');
        $db->statement('INSERT INTO rec_parent VALUES (3000000000), (9007199254740993)');
        $db->statement('INSERT INTO rec_flags VALUES (true, 1), (false, 2)');
        $db->statement('INSERT INTO rec_flag_kids VALUES (1, true, 1), (2, true, 1)');
        $factory->release($db);

        $rels = $this->actingAs($saved->user)->getJson(route('api.schema.show', $saved))->json('snapshot.relationships');
        $rel = fn (string $from, string $to) => collect($rels)->first(fn ($r) => $r['from_table'] === $from && $r['to_table'] === $to)['id'];
        $related = fn (string $table, array $key, string $rel, string $dir, array $extra = []) => $this->actingAs($saved->user)->getJson(
            route('api.records.related', [$saved, $table, 'key' => json_encode($key), 'rel' => $rel, 'dir' => $dir, ...$extra])
        );

        // Source value exceeds the narrower child column: class 22 on the target query means no children.
        $res = $related('rec_parent', ['id' => 3000000000], $rel('rec_child', 'rec_parent'), 'in')->assertOk();
        expect($res->json('rows'))->toBe([])->and($res->json('next_cursor'))->toBeNull();

        // A cursor value outside the key column's range is an empty page, not an error.
        $cursor = rtrim(strtr(base64_encode(json_encode([99999999999999999999])), '+/', '-_'), '=');
        $db = $factory->make($saved);
        $db->statement('INSERT INTO rec_child VALUES (1, NULL)');
        $factory->release($db);
        $res = $related('rec_parent', ['id' => 3000000000], $rel('rec_child', 'rec_parent'), 'in', ['cursor' => $cursor])->assertOk();
        expect($res->json('rows'))->toBe([])->and($res->json('next_cursor'))->toBeNull();

        // Boolean key columns travel as text and the cursor round-trips them.
        $page = $related('rec_flags', ['active' => 'true', 'n' => 1], $rel('rec_flag_kids', 'rec_flags'), 'in', ['limit' => 1])->assertOk();
        expect($page->json('rows.0.key'))->toBe(['id' => 1])->and($page->json('next_cursor'))->not->toBeNull();
        $next = $related('rec_flags', ['active' => 'true', 'n' => 1], $rel('rec_flag_kids', 'rec_flags'), 'in', ['limit' => 1, 'cursor' => $page->json('next_cursor')])->assertOk();
        expect($next->json('rows.0.key'))->toBe(['id' => 2]);

        // Missing source whose key is not a value of the column is 404, not an error.
        $related('rec_parent', ['id' => '99999999999999999999'], $rel('rec_child', 'rec_parent'), 'in')->assertNotFound()->assertJsonPath('error.reason', 'record_missing');

        // Big integer keys stay exact as strings in returned keys.
        $db = $factory->make($saved);
        $db->statement('CREATE TABLE rec_big_kids (id BIGINT PRIMARY KEY, parent_id BIGINT REFERENCES rec_parent(id))');
        $db->statement('INSERT INTO rec_big_kids VALUES (9007199254740993, 9007199254740993)');
        $factory->release($db);
        $rels = $this->actingAs($saved->user)->postJson(route('api.schema.refresh', $saved))->assertOk()->json('snapshot.relationships');
        $big = collect($rels)->first(fn ($r) => $r['from_table'] === 'rec_big_kids' && $r['to_table'] === 'rec_parent')['id'];
        $res = $related('rec_parent', ['id' => '9007199254740993'], $big, 'in')->assertOk();
        expect($res->json('rows.0.key'))->toBe(['id' => '9007199254740993']);
    } finally {
        $db = $factory->make($saved);
        foreach (['rec_big_kids', 'rec_child', 'rec_flag_kids', 'rec_parent', 'rec_flags'] as $t) {
            $db->statement("DROP TABLE IF EXISTS {$t}");
        }
        CommerceSchema::drop($db);
        $factory->release($db);
    }
});
