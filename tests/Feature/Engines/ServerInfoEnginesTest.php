<?php

use App\Database\Drivers\MySqlDriver;
use App\Database\Schema\SnapshotService;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

function savedEngineConnection(string $engine): SavedConnection
{
    Engines::skipUnlessAvailable($engine);
    $connection = Engines::savedConnection($engine);
    $connection->user()->associate(User::factory()->create());
    $connection->save();

    return $connection;
}

it('records the server details with each snapshot', function (string $engine) {
    $connection = savedEngineConnection($engine);

    $info = app(SnapshotService::class)->refresh($connection)->server_info;

    expect($info['version'])->toMatch('/^\d+\.\d+/')
        ->and($info['charset'])->toBeString()->not->toBeEmpty()
        ->and($info['size_bytes'])->toBeInt()->toBeGreaterThanOrEqual(0);
    if ($engine === 'sqlite') {
        expect($info['user'])->toBeNull()->and($info['ssl'])->toBeNull()->and($info['timezone'])->toBeNull();
    } else {
        expect($info['user'])->toContain(Engines::params($engine)['username'])
            ->and($info['ssl'])->toBeBool()
            ->and($info['timezone'])->toBeString()->not->toBeEmpty()
            ->and($info['collation'])->toBeString()->not->toBeEmpty();
    }
})->with(Engines::ENGINES);

it('still stores the snapshot when the server details fail', function () {
    $connection = savedEngineConnection('mysql');
    app()->bind(MySqlDriver::class, fn () => new class extends MySqlDriver
    {
        public function serverInfo(Connection $db, SavedConnection $connection): array
        {
            throw new RuntimeException('no details');
        }
    });

    $snapshot = app(SnapshotService::class)->refresh($connection);

    expect($snapshot->exists)->toBeTrue()->and($snapshot->server_info)->toBeNull();
});
