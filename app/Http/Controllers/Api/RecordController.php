<?php

namespace App\Http\Controllers\Api;

use App\Database\ColumnKind;
use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Records\RecordKey;
use App\Database\Records\RecordReader;
use App\Database\Schema\ColumnInfo;
use App\Database\Schema\SnapshotService;
use App\Database\Schema\TableInfo;
use App\Http\Controllers\Controller;
use App\Http\Requests\RecordRequest;
use App\Http\Requests\RelatedRecordsRequest;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use Illuminate\Database\Connection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * @phpstan-import-type TableArray from TableInfo
 * @phpstan-import-type ColumnArray from ColumnInfo
 */
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
            $record = $this->factory->using($connection, fn (Connection $db) => $this->reader->read($db, $driver, $snapshot->payload, $info, $key), (int) config('dbzuper.query_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($this->errors->map($e));
        }

        return $record === null
            ? response()->json(['error' => ['kind' => 'not_found', 'message' => 'Record not found.', 'sqlstate' => null, 'reason' => 'record_missing']], 404)
            : response()->json($record);
    }

    public function related(RelatedRecordsRequest $request, SavedConnection $connection, string $table): JsonResponse
    {
        Gate::authorize('view', $connection);
        [$snapshot, $source] = $this->table($connection, $table);
        if ($response = $this->notExplorable($source)) {
            return $response;
        }
        $key = RecordKey::fromJson($request->validated('key'), $source);
        $dir = $request->validated('dir') === 'out' ? 'out' : 'in';
        $rel = $snapshot->relationship((string) $request->validated('rel'));
        $sourceSide = $dir === 'out' ? 'from_table' : 'to_table';
        if ($rel === null || $rel[$sourceSide] !== $source['name']) {
            throw ValidationException::withMessages(['rel' => 'Unknown relationship for this table and direction.']);
        }
        $targetName = $dir === 'out' ? $rel['to_table'] : $rel['from_table'];
        $target = $snapshot->table($targetName);
        abort_if($target === null, 404);
        if ($response = $this->notExplorable($target)) {
            return $response;
        }
        $after = $this->decodeCursor($request->validated('cursor'), $target);
        $limit = (int) $request->validated('limit', 25);
        $driver = $this->drivers->for($connection->driver);

        try {
            $result = $this->factory->using($connection, fn (Connection $db) => $this->reader->related($db, $driver, $source, $key, $rel, $dir, $target, $limit, $after), (int) config('dbzuper.query_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($this->errors->map($e));
        }
        if ($result === null) {
            return response()->json(['error' => ['kind' => 'not_found', 'message' => 'Record not found.', 'sqlstate' => null, 'reason' => 'record_missing']], 404);
        }

        return response()->json([
            'table' => $target['name'],
            'columns' => array_map(fn ($c) => ['name' => $c['name'], 'type' => $c['type']], $target['columns']),
            'primary_key' => $target['primary_key'],
            'rows' => $result['rows'],
            'next_cursor' => $result['next_after'] === null ? null : rtrim(strtr(base64_encode(json_encode($result['next_after'], JSON_THROW_ON_ERROR)), '+/', '-_'), '='),
        ]);
    }

    /**
     * @param  TableArray  $target
     * @return list<string|int|float>|null
     */
    private function decodeCursor(?string $cursor, array $target): ?array
    {
        if ($cursor === null || $cursor === '') {
            return null;
        }
        $json = base64_decode(strtr($cursor, '-_', '+/'), true);
        $values = $json === false ? null : json_decode($json, true, 3, JSON_BIGINT_AS_STRING);
        $valid = is_array($values) && array_is_list($values) && count($values) === count($target['primary_key'])
            && array_reduce($values, fn ($ok, $v) => $ok && (is_string($v) || is_int($v) || is_float($v)), true);
        if (! $valid) {
            throw ValidationException::withMessages(['cursor' => 'Invalid cursor.']);
        }

        return $values;
    }

    /** @return array{0: StoredSnapshot, 1: TableArray} */
    private function table(SavedConnection $connection, string $table): array
    {
        $snapshot = $this->snapshots->current($connection);
        $info = $snapshot->table($table);
        abort_if($info === null, 404);

        return [$snapshot, $info];
    }

    /**
     * Binary keys cannot travel through a JSON key, so such records are not addressable.
     *
     * @param  TableArray  $info
     */
    private function hasBinaryKey(array $info): bool
    {
        foreach ($this->keyColumns($info) as $column) {
            if (ColumnKind::classify(strtolower($column['type_name'])) === ColumnKind::Binary) {
                return true;
            }
        }

        return false;
    }

    /**
     * PDO binds floats with 14 digits of precision, so keyset paging and key equality on them repeat or miss rows.
     *
     * @param  TableArray  $info
     */
    private function hasFloatKey(array $info): bool
    {
        foreach ($this->keyColumns($info) as $column) {
            if (preg_match('/^\s*(real|double|float)(?![a-z])/i', $column['type_name'])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  TableArray  $info
     * @return list<ColumnArray>
     */
    private function keyColumns(array $info): array
    {
        return array_values(array_filter($info['columns'], fn ($c) => in_array($c['name'], $info['primary_key'], true)));
    }

    /** @param TableArray $info */
    private function notExplorable(array $info): ?JsonResponse
    {
        $hasKey = $info['primary_key'] !== [] && $info['kind'] === 'table';
        $what = match (true) {
            ! $hasKey => 'no primary key',
            $this->hasBinaryKey($info) => 'a binary primary key',
            $this->hasFloatKey($info) => 'a floating-point primary key',
            default => null,
        };
        if ($what === null) {
            return null;
        }

        return response()->json(['error' => [
            'kind' => 'unknown', 'sqlstate' => null, 'reason' => 'no_primary_key',
            'message' => "{$info['name']} has {$what}; open it in a table tab instead.",
        ]], 422);
    }
}
