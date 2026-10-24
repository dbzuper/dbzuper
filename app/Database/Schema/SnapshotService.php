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
            $snapshot = $this->factory->using($connection, function (Connection $db) use ($connection) {
                return $this->drivers->for($connection->driver)->inspector()->inspect($db, $connection);
            }, (int) config('dbsuperb.introspection_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($this->errors->map($e));
        }

        $payload = $snapshot->toArray();
        $stored = $connection->snapshots()->create([
            'hash' => $snapshot->structureHash(),
            'payload' => $payload,
            ...SnapshotSummary::of($payload),
        ]);

        $keep = (int) config('dbsuperb.snapshot_keep');
        $stale = $connection->snapshots()->orderByDesc('id')->pluck('id')->slice($keep);

        if ($stale->isNotEmpty()) {
            StoredSnapshot::whereIn('id', $stale->all())->delete();
        }

        return $stored;
    }
}
