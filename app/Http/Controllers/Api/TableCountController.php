<?php

namespace App\Http\Controllers\Api;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Query\TableCountQuery;
use App\Database\Schema\SnapshotService;
use App\Http\Controllers\Controller;
use App\Http\Requests\TableCountRequest;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Throwable;

class TableCountController extends Controller
{
    public function __invoke(TableCountRequest $request, SavedConnection $connection, string $table, SnapshotService $snapshots, ConnectionFactory $factory, DriverRegistry $drivers, DbErrorMapper $errors): JsonResponse
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
        $exact = $request->boolean('exact');
        $timeout = $exact ? (int) config('dbsuperb.query_timeout') : (int) config('dbsuperb.count_cap_seconds');

        try {
            $count = $factory->using($connection, fn (Connection $db) => TableCountQuery::run($db, $drivers->for($connection->driver), $info, $filters), $timeout);
        } catch (Throwable $e) {
            $error = $errors->map($e);
            // Hitting the background cap is an answer ("more than we could count quickly"), not a failure.
            if (! $exact && $error->kind === 'timeout') {
                return response()->json(['count' => null, 'kind' => 'timeout']);
            }
            throw new DatabaseOperationFailed($error);
        }

        return response()->json(['count' => $count, 'kind' => 'exact']);
    }
}
