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
