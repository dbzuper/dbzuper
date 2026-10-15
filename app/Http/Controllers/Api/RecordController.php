<?php

namespace App\Http\Controllers\Api;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Records\RecordKey;
use App\Database\Records\RecordReader;
use App\Database\Schema\SnapshotService;
use App\Http\Controllers\Controller;
use App\Http\Requests\RecordRequest;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Throwable;

class RecordController extends Controller
{
    public function __construct(
        private readonly SnapshotService $snapshots,
        private readonly ConnectionFactory $factory,
        private readonly DriverRegistry $drivers,
        private readonly DbErrorMapper $errors,
        private readonly RecordReader $reader,
    ) {}

    public function show(RecordRequest $request, SavedConnection $connection, string $table): JsonResponse
    {
        Gate::authorize('view', $connection);
        [$snapshot, $info] = $this->table($connection, $table);
        if ($response = $this->notExplorable($info)) {
            return $response;
        }
        $key = RecordKey::fromJson($request->validated('key'), $info);
        $driver = $this->drivers->for($connection->driver);

        try {
            $record = $this->factory->using($connection, fn (Connection $db) => $this->reader->read($db, $driver, $snapshot, $info, $key), (int) config('dbsuperb.query_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($this->errors->map($e));
        }

        return $record === null
            ? response()->json(['error' => ['kind' => 'not_found', 'message' => 'Record not found.', 'sqlstate' => null, 'reason' => 'record_missing']], 404)
            : response()->json($record);
    }

    /** @return array{0: array, 1: array} */
    private function table(SavedConnection $connection, string $table): array
    {
        $snapshot = $this->snapshots->current($connection)->payload;
        $info = collect($snapshot['tables'] ?? [])->firstWhere('name', $table);
        abort_if($info === null, 404);

        return [$snapshot, $info];
    }

    private function notExplorable(array $info): ?JsonResponse
    {
        if (($info['kind'] ?? 'table') === 'table' && ($info['primary_key'] ?? []) !== []) {
            return null;
        }

        return response()->json(['error' => [
            'kind' => 'unknown', 'sqlstate' => null, 'reason' => 'no_primary_key',
            'message' => "{$info['name']} has no primary key; open it in the Data tab instead.",
        ]], 422);
    }
}
