<?php

use App\Database\ConnectionFactory;
use App\Database\Drivers\MariaDbDriver;
use App\Database\Drivers\MySqlDriver;
use App\Database\Drivers\PostgresDriver;
use App\Database\Drivers\SqliteDriver;
use App\Database\Schema\SnapshotService;
use App\Database\SqlitePathPolicy;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

// SQLite does not understand any of these SET statements, so each one throws a real QueryException.
it('treats the statement timeout as best-effort when the server rejects it', function (string $driver) {
    $saved = Engines::savedConnection('sqlite');

    $ok = app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($driver) {
        app($driver)->applyStatementTimeout($db, 7);

        return (int) $db->selectOne('select 1 as one')->one;
    });

    expect($ok)->toBe(1);
})->with([MySqlDriver::class, MariaDbDriver::class, PostgresDriver::class]);

it('still refreshes a snapshot when the timeout statement fails', function () {
    $db = Engines::sqlitePath();
    (new PDO('sqlite:'.$db))->exec('create table widgets (id integer primary key)');

    app()->bind(SqliteDriver::class, fn ($app) => new class($app->make(SqlitePathPolicy::class)) extends SqliteDriver
    {
        public function applyStatementTimeout(Connection $db, int $seconds): void
        {
            app(MySqlDriver::class)->applyStatementTimeout($db, $seconds);
        }
    });

    $connection = SavedConnection::factory()->for(User::factory())->create([
        'driver' => DriverName::Sqlite, 'host' => null, 'port' => null, 'database' => $db,
        'username' => null, 'password' => null,
    ]);

    $stored = app(SnapshotService::class)->refresh($connection);

    expect(collect($stored->payload['tables'])->pluck('name')->all())->toContain('widgets');
});
