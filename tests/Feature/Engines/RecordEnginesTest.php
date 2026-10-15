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
