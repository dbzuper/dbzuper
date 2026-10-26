<?php

namespace App\Database;

use App\Database\Drivers\DsnValue;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use Illuminate\Database\Connection;
use Throwable;

/** The databases a server-level connection's login can see, with sizes and table counts where they come cheap. */
class DatabaseLister
{
    public function __construct(
        private readonly ConnectionFactory $factory,
        private readonly DriverRegistry $drivers,
        private readonly DbErrorMapper $errors,
    ) {}

    /** @return list<DatabaseEntry> sorted by name */
    public function list(SavedConnection $connection): array
    {
        [$names, $stats] = $this->read($connection);
        $system = $this->drivers->for($connection->driver)->systemDatabases();
        $snapshotTables = $this->snapshotTableCounts($connection);

        $entries = array_map(fn (string $name) => new DatabaseEntry(
            $name,
            in_array($name, $system, true),
            $stats[$name]['tables'] ?? $snapshotTables[$name] ?? null,
            $stats[$name]['bytes'] ?? null,
            DsnValue::isSafeDatabaseName($connection->driver, $name),
        ), $names);
        usort($entries, fn (DatabaseEntry $a, DatabaseEntry $b) => strcmp($a->name, $b->name));

        return $entries;
    }

    /**
     * Names and stats over the first maintenance database that accepts the login. Stats are best effort: a failure
     * or timeout leaves them out rather than hiding the list.
     *
     * @return array{list<string>, array<string, array{tables: ?int, bytes: ?int}>}
     */
    private function read(SavedConnection $connection): array
    {
        $driver = $this->drivers->for($connection->driver);
        $first = null;
        foreach ($driver->maintenanceDatabases() as $database) {
            try {
                return $this->factory->using($connection->forMaintenance($database), function (Connection $db) use ($driver) {
                    $names = $driver->listDatabaseNames($db);
                    try {
                        $stats = $driver->databaseStats($db);
                    } catch (Throwable $e) {
                        report($e);
                        $stats = [];
                    }

                    return [$names, $stats];
                }, (int) config('dbsuperb.introspection_timeout'));
            } catch (Throwable $e) {
                $first ??= $e;
            }
        }

        throw new DatabaseOperationFailed($this->errors->map($first));
    }

    /** @return array<string, int> table count of each database's latest snapshot */
    private function snapshotTableCounts(SavedConnection $connection): array
    {
        if (! $connection->exists) {
            return [];
        }

        return StoredSnapshot::query()
            ->whereIn('id', StoredSnapshot::query()->selectRaw('max(id)')
                ->where('connection_id', $connection->id)->where('database', '<>', '')->groupBy('database'))
            ->whereNotNull('table_count')
            ->pluck('table_count', 'database')
            ->map(fn ($count) => (int) $count)
            ->all();
    }
}
