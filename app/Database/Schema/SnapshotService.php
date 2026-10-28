<?php

namespace App\Database\Schema;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use Illuminate\Database\Connection;
use Throwable;

final class SnapshotService
{
    public function __construct(
        private readonly ConnectionFactory $factory,
        private readonly DriverRegistry $drivers,
        private readonly DbErrorMapper $errors,
    ) {}

    public function current(SavedConnection $connection): StoredSnapshot
    {
        return $connection->snapshots()->latest('id')->first() ?? $this->refresh($connection);
    }

    public function refresh(SavedConnection $connection): StoredSnapshot
    {
        try {
            [$snapshot, $serverInfo] = $this->factory->using($connection, function (Connection $db) use ($connection) {
                $driver = $this->drivers->for($connection->driver);
                $snapshot = $driver->inspector()->inspect($db, $connection);
                try {
                    // Best effort: the info panel can do without it, the schema can't wait for it.
                    $serverInfo = $driver->serverInfo($db, $connection);
                } catch (Throwable $e) {
                    report($e);
                    $serverInfo = null;
                }

                return [$snapshot, $serverInfo];
            }, (int) config('dbzuper.introspection_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($this->errors->map($e));
        }

        $payload = $snapshot->toArray();
        $stored = $connection->snapshots()->create([
            'hash' => $snapshot->structureHash(),
            'payload' => $payload,
            'server_info' => $serverInfo,
            ...SnapshotSummary::of($payload),
        ]);

        $keep = (int) config('dbzuper.snapshot_keep');
        $stale = $connection->snapshots()->orderByDesc('id')->pluck('id')->slice($keep);

        if ($stale->isNotEmpty()) {
            StoredSnapshot::whereIn('id', $stale->all())->delete();
        }

        return $stored;
    }
}
