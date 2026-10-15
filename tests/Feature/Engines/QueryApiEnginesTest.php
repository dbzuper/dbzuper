<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use Tests\Support\Engines;

function engineConnection(string $engine, User $user, array $overrides = []): SavedConnection
{
    $p = Engines::params($engine);

    return SavedConnection::factory()->for($user)->create([
        'driver' => DriverName::from($engine), 'host' => $p['host'], 'port' => $p['port'],
        'database' => $p['database'], 'username' => $p['username'], 'password' => $p['password'], 'read_only' => true,
        ...$overrides,
    ]);
}

it('runs reads and reports syntax positions on server engines', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $user = User::factory()->create();
    $connection = engineConnection($engine, $user);

    $this->actingAs($user)->postJson(route('api.query.run', $connection), ['statements' => [['sql' => 'select 1 as one']]])
        ->assertOk()->assertJsonPath('results.0.rows.0.0', 1);

    $res = $this->actingAs($user)->postJson(route('api.query.run', $connection), ['statements' => [['sql' => "select *\nform x"]]])->assertOk();
    expect($res->json('results.0.error.position.line'))->toBe(2);
})->with(['mysql', 'mariadb', 'pgsql']);

it('keeps a read-only connection read-only even when dynamic SQL switches the session guard off', function () {
    Engines::skipUnlessAvailable('pgsql');
    $pdo = Engines::pdo('pgsql');
    $pdo->exec('drop table if exists m3_ro_probe');
    $pdo->exec('create table m3_ro_probe (id int)');
    // Volatile functions stand in for the dynamic SQL the classifier cannot see through.
    $pdo->exec("create or replace function m3_ro_flip() returns text language plpgsql as $$ begin return set_config('default_transaction_read_only', 'off', false); end $$");
    $pdo->exec('create or replace function m3_ro_write() returns int language plpgsql as $$ begin insert into m3_ro_probe values (1); return 1; end $$');

    try {
        $user = User::factory()->create();
        $connection = engineConnection('pgsql', $user);
        $flip = 'select m3_ro_flip()';
        $write = 'select m3_ro_write()';

        // Both items classify as plain reads, so the guard lets them through; only the runner's per-statement
        // re-assertion stops the second from writing.
        $res = $this->actingAs($user)->postJson(route('api.query.run', $connection), ['statements' => [['sql' => $flip], ['sql' => $write]]])->assertOk();

        expect($res->json('results.0.error'))->toBeNull()
            ->and($res->json('results.1.error.kind'))->toBe('readonly')
            ->and((int) $pdo->query('select count(*) from m3_ro_probe')->fetchColumn())->toBe(0);
    } finally {
        $pdo->exec('drop function if exists m3_ro_flip()');
        $pdo->exec('drop function if exists m3_ro_write()');
        $pdo->exec('drop table if exists m3_ro_probe');
    }
});

it('runs a transaction block on a read-only connection', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $user = User::factory()->create();
    $connection = engineConnection($engine, $user);

    $res = $this->actingAs($user)->postJson(route('api.query.run', $connection), ['statements' => [['sql' => 'begin'], ['sql' => 'select 1 as one'], ['sql' => 'commit']]])->assertOk();

    expect($res->json('results'))->toHaveCount(3)
        ->and(collect($res->json('results'))->pluck('error')->filter()->all())->toBe([]);
})->with(['mysql', 'mariadb', 'pgsql']);
