<?php

namespace App\Http\Controllers\Api;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Editing\EditPlanCache;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Query\DateFilters;
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
    public function __invoke(TableRowsRequest $request, SavedConnection $connection, string $table, SnapshotService $snapshots, ConnectionFactory $factory, DriverRegistry $drivers, DbErrorMapper $errors, EditPlanCache $plans): JsonResponse
    {
        Gate::authorize('view', $connection);
        $snapshot = $snapshots->current($connection);
        $info = collect($snapshot->payload['tables'] ?? [])->firstWhere('name', $table);
        abort_if($info === null, 404);

        $names = array_column($info['columns'], 'name');
        $filters = $request->validated('filters', []);
        foreach ($filters as $i => $f) {
            if (! in_array($f['column'], $names, true)) {
                throw ValidationException::withMessages(["filters.{$i}.column" => 'Unknown column.']);
            }
        }
        DateFilters::validate($filters, $info['columns']);
        $sort = $request->validated('sort') ?? [];
        foreach ($sort as $i => $s) {
            if (! in_array($s['column'], $names, true)) {
                throw ValidationException::withMessages(["sort.{$i}.column" => 'Unknown column.']);
            }
        }
        $page = (int) $request->validated('page', 1);
        $perPage = (int) $request->validated('per_page', 100);

        try {
            $data = $factory->using($connection, function (Connection $db) use ($connection, $snapshot, $drivers, $info, $filters, $sort, $page, $perPage, $plans) {
                $plan = $plans->for($connection, $snapshot, $info, $db);

                return TableRowsQuery::run($db, $drivers->for($connection->driver), $info, $filters, $sort, $page, $perPage, $plan);
            }, (int) config('dbzuper.query_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($errors->map($e));
        }

        return response()->json($data + ['page' => $page, 'per_page' => $perPage]);
    }
}
