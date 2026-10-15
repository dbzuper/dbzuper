<?php

namespace App\Http\Controllers\Api;

use App\Database\CellValue;
use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Schema\SnapshotService;
use App\Http\Controllers\Controller;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Throwable;

class TableController extends Controller
{
    public const SAMPLE_LIMIT = 50;

    public function __construct(
        private readonly SnapshotService $snapshots,
        private readonly ConnectionFactory $factory,
        private readonly DriverRegistry $drivers,
        private readonly DbErrorMapper $errors,
    ) {}

    public function sample(SavedConnection $connection, string $table): JsonResponse
    {
        Gate::authorize('view', $connection);
        $info = $this->tableFromSnapshot($connection, $table);
        $columns = array_column($info['columns'], 'name');

        $driver = $this->drivers->for($connection->driver);
        $rows = $this->run($connection, fn (Connection $db) => $db
            ->table($db->raw($driver->quoteIdentifier($info['name'])))
            ->select(array_map(fn (array $c) => $driver->sampleColumn($db, $c['name'], strtolower((string) ($c['type_name'] ?? ''))), $info['columns']))
            ->limit(self::SAMPLE_LIMIT)
            ->get()->all());

        return response()->json([
            'columns' => $columns,
            'rows' => array_map(function (object $row) use ($columns) {
                $values = (array) $row;

                return array_map(fn (string $c) => CellValue::present($values[$c] ?? null), $columns);
            }, $rows),
            'limit' => self::SAMPLE_LIMIT,
        ]);
    }

    public function ddl(SavedConnection $connection, string $table): JsonResponse
    {
        Gate::authorize('view', $connection);
        $info = $this->tableFromSnapshot($connection, $table);

        $ddl = $this->run($connection, fn (Connection $db) => $this->drivers->for($connection->driver)->ddl($db, $info['name'], $info['kind']));

        return response()->json(['ddl' => $ddl]);
    }

    /** Only objects present in the current snapshot may be queried. */
    private function tableFromSnapshot(SavedConnection $connection, string $table): array
    {
        $info = collect($this->snapshots->current($connection)->payload['tables'] ?? [])->firstWhere('name', $table);
        abort_if($info === null, 404);

        return $info;
    }

    private function run(SavedConnection $connection, callable $callback): mixed
    {
        try {
            return $this->factory->using($connection, function (Connection $db) use ($connection, $callback) {
                $this->drivers->for($connection->driver)->applyStatementTimeout($db, (int) config('dbsuperb.query_timeout'));

                return $callback($db);
            });
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($this->errors->map($e));
        }
    }
}
