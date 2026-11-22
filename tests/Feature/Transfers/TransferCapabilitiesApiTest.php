<?php

use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Models\SavedConnection;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use App\Transfers\TransferPlanner;
use App\Transfers\WorkerHeartbeat;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;
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
    $this->path = $path;
});

afterEach(fn () => Engines::resetSqlite());

it('reports capabilities for SQLite: built-in only', function () {
    $json = $this->actingAs($this->user)->getJson("/api/c/{$this->connection->id}/transfers/capabilities")->assertOk()->json();

    expect($json['read_only'])->toBeFalse()
        ->and($json['database_name'])->toBe(basename($this->path))
        ->and($json['worker_alive'])->toBeFalse()
        ->and($json['export']['default_method'])->toBe('builtin')
        ->and($json['export']['native']['usable'])->toBeFalse()
        ->and($json['export']['builtin_gaps'])->toBeArray()
        ->and($json['export']['native_gaps'])->toBe([])
        ->and($json['import']['default_method'])->toBe('builtin')
        ->and($json['import']['all_or_nothing'])->toBeTrue();
});

it('forbids other users', function () {
    $this->actingAs(User::factory()->create())->getJson("/api/c/{$this->connection->id}/transfers/capabilities")->assertForbidden();
    $this->actingAs(User::factory()->create())->getJson("/api/c/{$this->connection->id}/transfers/objects")->assertForbidden();
});

it('reports read-only connections', function () {
    $this->connection->update(['read_only' => true]);

    $this->actingAs($this->user)->getJson("/api/c/{$this->connection->id}/transfers/capabilities")->assertOk()->assertJsonPath('read_only', true);
});

it('follows the worker heartbeat', function () {
    WorkerHeartbeat::beat();

    $this->actingAs($this->user)->getJson("/api/c/{$this->connection->id}/transfers/capabilities")->assertJsonPath('worker_alive', true);
});

it('lists tables and views with row estimates', function () {
    $objects = collect($this->actingAs($this->user)->getJson("/api/c/{$this->connection->id}/transfers/objects")->assertOk()->json('objects'));

    expect($objects->firstWhere('name', 'users'))->toMatchArray(['kind' => 'table', 'key' => 'users', 'schema' => null, 'rows' => 3])
        ->and($objects->firstWhere('name', 'order_totals'))->toMatchArray(['kind' => 'view', 'rows' => null])
        ->and($objects->pluck('name'))->not->toContain('sqlite_master');
});

it('resolves methods: native requested but unusable is a 422, built-in always allowed', function () {
    $planner = app(TransferPlanner::class);

    [$method] = $planner->resolve($this->connection, TransferDirection::Export, null);
    expect($method)->toBe(TransferMethod::Builtin);

    [$method] = $planner->resolve($this->connection, TransferDirection::Import, TransferMethod::Builtin);
    expect($method)->toBe(TransferMethod::Builtin);

    try {
        $planner->resolve($this->connection, TransferDirection::Export, TransferMethod::Native);
        $this->fail('expected 422');
    } catch (HttpException $e) {
        expect($e->getStatusCode())->toBe(422)->and($e->getMessage())->toBe('SQLite always uses the built-in method');
    }
});

it('caches the tool check per driver and server version', function () {
    Cache::flush();
    config(['dbzuper.transfer_tools.pg_dump' => null]);
    $planner = app(TransferPlanner::class);
    $c = new SavedConnection(['driver' => DriverName::Postgres, 'database' => 'x']);

    $first = $planner->check($c, '16.2', TransferDirection::Export);

    // A tool appearing within the minute is not seen yet.
    $script = tempnam(sys_get_temp_dir(), 'pgd');
    file_put_contents($script, "#!/bin/sh\necho \"pg_dump (PostgreSQL) 17.0\"\n");
    config(['dbzuper.transfer_tools.pg_dump' => $script]);
    $second = $planner->check($c, '16.2', TransferDirection::Export);
    $other = $planner->check($c, '15.1', TransferDirection::Export);
    unlink($script);

    expect($second)->toEqual($first)
        ->and($other->path)->toBe($script);
});
