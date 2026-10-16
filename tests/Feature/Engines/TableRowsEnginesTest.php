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
        // contains / starts_with / ends_with ignore case on every engine (PostgreSQL via ILIKE).
        foreach ([['contains', 'ADA'], ['starts_with', 'ada'], ['ends_with', 'LACE']] as [$op, $value]) {
            expect($rows('users', ['filters' => [['column' => 'name', 'op' => $op, 'value' => $value]]])->assertOk()->json('rows.0.2'))->toBe('Ada Lovelace');
        }
        $rows('users', ['filters' => [['column' => 'id', 'op' => 'eq', 'value' => '']]])->assertUnprocessable();
        $rows('users', ['sort' => ['column' => 'id', 'direction' => 'desc'], 'per_page' => 1])->assertOk()
            ->assertJsonPath('rows.0.0', 3)->assertJsonPath('has_more', true);
        expect($rows('audit_log', [])->assertOk()->json('rows.0.1'))->toBe(str_repeat('x', 4000).'…');
    } finally {
        $db = $factory->make($saved);
        CommerceSchema::drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);

it('returns display sql that yields the same rows as the API on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        $tricky = "O'Re".chr(92).'illy 100%';
        $db->table('users')->insert([
            ['id' => 100, 'name' => $tricky, 'email' => 'tricky@example.com'],
            ['id' => 101, 'name' => 'Plain 100x', 'email' => 'plain@example.com'],
        ]);
        $factory->release($db);
        $user = $saved->user;

        foreach ([
            ['column' => 'name', 'op' => 'eq', 'value' => $tricky],
            ['column' => 'name', 'op' => 'contains', 'value' => '100%'],
            ['column' => 'name', 'op' => 'ends_with', 'value' => chr(92).'illy 100%'],
            ['column' => 'name', 'op' => 'neq', 'value' => "'"],
        ] as $filter) {
            $res = $this->actingAs($user)->postJson(route('api.tables.rows', [$saved, 'users']), ['filters' => [$filter]])->assertOk();
            $ran = $factory->using($saved, fn ($db) => $db->select($res->json('sql')), 30);

            expect($res->json('rows'))->not->toBeEmpty()
                ->and(array_map(fn ($r) => array_values((array) $r)[0], $ran))->toEqual(array_column($res->json('rows'), 0));
        }
    } finally {
        $db = $factory->make($saved);
        CommerceSchema::drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);
