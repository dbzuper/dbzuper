<?php

use App\Database\ConnectionFactory;
use App\Models\User;
use Tests\Support\Engines;

it('returns a timeout result instead of an error when the capped count is too slow', function () {
    Engines::skipUnlessAvailable('pgsql');
    config(['dbsuperb.count_cap_seconds' => 1]);
    $saved = Engines::savedConnection('pgsql');
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);
    try {
        $db->statement('DROP VIEW IF EXISTS m6_slow_count');
        $db->statement('CREATE VIEW m6_slow_count AS SELECT 1 AS id FROM pg_sleep(2)');
        $factory->release($db);

        $this->actingAs($saved->user)->postJson(route('api.tables.count', [$saved, 'm6_slow_count']), [])
            ->assertOk()->assertExactJson(['count' => null, 'kind' => 'timeout']);
        // exact=true uses the normal query timeout and finishes.
        $this->actingAs($saved->user)->postJson(route('api.tables.count', [$saved, 'm6_slow_count']), ['exact' => true])
            ->assertOk()->assertExactJson(['count' => 1, 'kind' => 'exact']);
    } finally {
        $db = $factory->make($saved);
        $db->statement('DROP VIEW IF EXISTS m6_slow_count');
        $factory->release($db);
    }
});
