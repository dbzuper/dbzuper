<?php

namespace App\Http\Controllers\Api;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Query\TableRowsQuery;
use App\Database\Schema\SnapshotService;
use App\Http\Controllers\Controller;
use App\Http\Requests\TableRowsRequest;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Throwable;

class TableRowsController extends Controller
{
    public function __invoke(TableRowsRequest $request, SavedConnection $connection, string $table, SnapshotService $snapshots, ConnectionFactory $factory, DriverRegistry $drivers, DbErrorMapper $errors): JsonResponse
    {
        Gate::authorize('view', $connection);
        $info = collect($snapshots->current($connection)->payload['tables'] ?? [])->firstWhere('name', $table);
        abort_if($info === null, 404);

        $names = array_column($info['columns'], 'name');
        $filters = $request->validated('filters', []);
        foreach ($filters as $i => $f) {
            if (! in_array($f['column'], $names, true)) {
                throw ValidationException::withMessages(["filters.{$i}.column" => 'Unknown column.']);
            }
        }
        $sort = $request->validated('sort') ?? [];
        foreach ($sort as $i => $s) {
            if (! in_array($s['column'], $names, true)) {
                throw ValidationException::withMessages(["sort.{$i}.column" => 'Unknown column.']);
            }
        }
        $page = (int) $request->validated('page', 1);
        $perPage = (int) $request->validated('per_page', 100);

        try {
            $data = $factory->using($connection, fn (Connection $db) => TableRowsQuery::run($db, $drivers->for($connection->driver), $info, $filters, $sort, $page, $perPage), (int) config('dbsuperb.query_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($errors->map($e));
        }

        return response()->json($data + ['page' => $page, 'per_page' => $perPage]);
    }
}
