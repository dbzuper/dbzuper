<?php

namespace App\Database\Drivers;

use App\Database\Contracts\Driver;
use App\Database\Contracts\SchemaInspector;
use App\Database\SqlitePathPolicy;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Pdo\Sqlite;

class SqliteDriver implements Driver
{
    public function __construct(private readonly SqlitePathPolicy $paths) {}

    public function name(): DriverName
    {
        return DriverName::Sqlite;
    }

    public function config(SavedConnection $connection): array
    {
        return [
            'driver' => 'sqlite',
            'database' => $this->paths->resolve($connection->database),
            'prefix' => '',
            'foreign_key_constraints' => true,
            'options' => $connection->read_only ? [Sqlite::ATTR_OPEN_FLAGS => Sqlite::OPEN_READONLY] : [],
        ];
    }

    public function inspector(): SchemaInspector
    {
        return app(SqliteInspector::class);
    }

    public function versionQuery(): string
    {
        return 'select sqlite_version() as version';
    }
}
