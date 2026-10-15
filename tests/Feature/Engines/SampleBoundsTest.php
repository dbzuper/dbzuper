<?php

use App\Database\ConnectionFactory;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Database\Connection;
use Illuminate\Database\Schema\Blueprint;
use Tests\Support\Engines;

it('bounds samples in SQL and quotes odd identifiers on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $params = Engines::params($engine);
    $saved = SavedConnection::factory()->for(User::factory()->create())->create([
        'driver' => $engine, 'host' => $params['host'], 'port' => $params['port'], 'database' => $params['database'],
        'username' => $params['username'], 'password' => $params['password'],
    ]);
    $factory = app(ConnectionFactory::class);

    $factory->using($saved, function (Connection $db) use ($engine) {
        $db->getSchemaBuilder()->dropIfExists('big_sample');
        [$q, $text, $bin] = $engine === 'pgsql' ? ['"', 'text', 'bytea'] : ['`', 'longtext', 'blob'];
        $db->statement("create table big_sample (id integer primary key, body {$text} null, blob_col {$bin} null, {$q}odd.name{$q} varchar(255) null)");
        $blob = $engine === 'pgsql' ? "decode(repeat('62', 3000), 'hex')" : "repeat('b', 3000)";
        $db->statement("insert into big_sample (id, body, blob_col, {$q}odd.name{$q}) values (1, ?, {$blob}, 'dotted')", [str_repeat('x', 5000)]);
        $db->statement("insert into big_sample (id, body, blob_col, {$q}odd.name{$q}) values (2, null, null, null)");
    });

    try {
        $response = $this->actingAs($saved->user)->getJson("/api/c/{$saved->id}/tables/big_sample/sample")->assertOk();

        expect($response->json('columns'))->toBe(['id', 'body', 'blob_col', 'odd.name'])
            ->and($response->json('rows.0.1'))->toBe(str_repeat('x', 200).'…')
            ->and($response->json('rows.0.2'))->toBe('[binary 3000 bytes]')
            ->and($response->json('rows.0.3'))->toBe('dotted')
            ->and($response->json('rows.1.1'))->toBeNull()
            ->and($response->json('rows.1.2'))->toBeNull();
    } finally {
        $factory->using($saved, fn (Connection $db) => $db->getSchemaBuilder()->dropIfExists('big_sample'));
    }
})->with(['mysql', 'mariadb', 'pgsql']);
