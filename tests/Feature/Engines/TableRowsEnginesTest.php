<?php

use App\Database\ConnectionFactory;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use Tests\Support\Engines;

it('filters rows with LIKE on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        $db->table('audit_log')->update(['payload' => str_repeat('x', 5000)]);
        $factory->release($db);
        $user = $saved->user;
        $rows = fn (string $table, array $body) => $this->actingAs($user)->postJson(route('api.tables.rows', [$saved, $table]), $body);

        // users.id is an integer: PostgreSQL needs the text cast for LIKE.
        $rows('users', ['filters' => [['column' => 'id', 'op' => 'contains', 'value' => '1']]])->assertOk()->assertJsonCount(1, 'rows');
        $rows('users', ['filters' => [['column' => 'name', 'op' => 'starts_with', 'value' => 'A']]])->assertOk()->assertJsonCount(2, 'rows');
        $rows('users', ['filters' => [['column' => 'name', 'op' => 'contains', 'value' => '%']]])->assertOk()->assertJsonCount(0, 'rows');
        $rows('users', ['filters' => [['column' => 'name', 'op' => 'contains', 'value' => '!']]])->assertOk()->assertJsonCount(0, 'rows');
        $rows('users', ['sort' => ['column' => 'id', 'direction' => 'desc'], 'per_page' => 1])->assertOk()
            ->assertJsonPath('rows.0.0', 3)->assertJsonPath('has_more', true);
        expect($rows('audit_log', [])->assertOk()->json('rows.0.1'))->toBe(str_repeat('x', 4000).'…');
    } finally {
        $db = $factory->make($saved);
        CommerceSchema::drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);
