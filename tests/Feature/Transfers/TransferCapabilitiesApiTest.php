<?php

use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Models\SavedConnection;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use App\Transfers\Native\ToolCheck;
use App\Transfers\TransferPlanner;
use App\Transfers\WorkerHeartbeat;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
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
        ->and($json['export']['native'])->not->toHaveKey('path')
        ->and($json['import']['native'])->not->toHaveKey('path')
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

it('takes the chosen tables as a JSON body, however many there are', function () {
    $keys = array_map(fn (int $i) => "table_{$i}", range(1, 2000));
    $seen = null;
    $this->mock(TransferPlanner::class, function ($mock) use (&$seen) {
        $mock->shouldReceive('capabilities')->andReturnUsing(function (SavedConnection $c, ?array $tables) use (&$seen) {
            $seen = $tables;

            return ['read_only' => false, 'database_name' => 'x', 'worker_alive' => false, 'export' => [], 'import' => []];
        });
    });

    $this->actingAs($this->user)->postJson("/api/c/{$this->connection->id}/transfers/capabilities", ['tables' => $keys])
        ->assertOk()->assertJsonPath('database_name', 'x');
    expect($seen)->toBe($keys);

    $this->actingAs($this->user)->postJson("/api/c/{$this->connection->id}/transfers/capabilities", ['tables' => 'all'])->assertOk();
    expect($seen)->toBeNull();
});

it('reads capabilities by POST like GET', function () {
    $json = $this->actingAs($this->user)->postJson("/api/c/{$this->connection->id}/transfers/capabilities", ['tables' => ['users']])
        ->assertOk()->json();

    expect($json['export']['default_method'])->toBe('builtin')
        ->and($json['database_name'])->toBe(basename($this->path));
});

it('rejects a malformed table list', function (mixed $tables) {
    $this->actingAs($this->user)->postJson("/api/c/{$this->connection->id}/transfers/capabilities", ['tables' => $tables])
        ->assertUnprocessable()->assertJsonValidationErrors('tables');
})->with([
    'a string other than all' => ['some'],
    'a non-string key' => [[1, 2]],
    'a map' => [['a' => 'users']],
    'an empty key' => [['']],
]);

it('forbids other users the POST form too', function () {
    $this->actingAs(User::factory()->create())->postJson("/api/c/{$this->connection->id}/transfers/capabilities", ['tables' => 'all'])->assertForbidden();
});

it('puts the polled transfer routes on the transfers limiter, not the shared API one', function (string $name) {
    // What actually runs: the group's middleware minus the route's exclusions.
    $router = app('router');
    $middleware = $router->gatherRouteMiddleware($router->getRoutes()->getByName($name));

    expect($middleware)->toContain('throttle:dbzuper-transfers')
        ->and($middleware)->not->toContain('throttle:dbzuper-api');
})->with(['api.transfers.show', 'api.transfers.index']);

it('puts upload chunks on their own limiter, apart from the polling and the shared API one', function () {
    $router = app('router');
    $middleware = $router->gatherRouteMiddleware($router->getRoutes()->getByName('api.transfers.upload'));

    expect($middleware)->toContain('throttle:dbzuper-uploads')
        ->and($middleware)->not->toContain('throttle:dbzuper-transfers')
        ->and($middleware)->not->toContain('throttle:dbzuper-api');
});

it('allows 3000 upload chunks a minute per user', function () {
    $user = User::factory()->create();
    $request = Request::create('/');
    $request->setUserResolver(fn () => $user);

    $limit = RateLimiter::limiter('dbzuper-uploads')($request);

    expect($limit->maxAttempts)->toBe(3000)
        ->and($limit->decaySeconds)->toBe(60)
        ->and($limit->key)->toBe($user->id);
});

it('keeps capabilities on the shared API limiter: they are read on demand, not polled', function (string $name) {
    $router = app('router');
    $middleware = $router->gatherRouteMiddleware($router->getRoutes()->getByName($name));

    expect($middleware)->toContain('throttle:dbzuper-api')
        ->and($middleware)->not->toContain('throttle:dbzuper-transfers');
})->with(['api.transfers.capabilities', 'api.transfers.capabilities.post']);

it('caps the chosen tables at 10,000', function () {
    $this->mock(TransferPlanner::class, function ($mock) {
        $mock->shouldReceive('capabilities')->andReturn(['read_only' => false, 'database_name' => 'x', 'worker_alive' => false, 'export' => [], 'import' => []]);
    });
    $keys = fn (int $n) => array_map(fn (int $i) => "t{$i}", range(1, $n));

    $this->actingAs($this->user)->postJson("/api/c/{$this->connection->id}/transfers/capabilities", ['tables' => $keys(10_000)])->assertOk();
    $this->actingAs($this->user)->postJson("/api/c/{$this->connection->id}/transfers/capabilities", ['tables' => $keys(10_001)])
        ->assertUnprocessable()->assertJsonPath('errors.tables.0', 'Choose at most 10,000 tables, or back up all of them');
});

it('keeps the tool path in the cached form but never in the browser form', function () {
    $check = new ToolCheck(true, 'mysqldump', '/usr/bin/mysqldump', '8.4.3', 'mysqldump 8.4.3');

    expect($check->toApiArray())->toBe(['usable' => true, 'tool' => 'mysqldump', 'version' => '8.4.3', 'reason' => 'mysqldump 8.4.3'])
        ->and(ToolCheck::fromArray($check->toArray()))->toEqual($check);
});
