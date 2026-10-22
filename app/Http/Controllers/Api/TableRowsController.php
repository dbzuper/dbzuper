<?php

namespace App\Http\Controllers\Api;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Editing\EditMethodResolver;
use App\Database\Editing\EditPlan;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Query\TableRowsQuery;
use App\Database\Schema\SnapshotService;
use App\Http\Controllers\Controller;
use App\Http\Requests\TableRowsRequest;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use Illuminate\Database\Connection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Throwable;

class TableRowsController extends Controller
{
    public function __invoke(TableRowsRequest $request, SavedConnection $connection, string $table, SnapshotService $snapshots, ConnectionFactory $factory, DriverRegistry $drivers, DbErrorMapper $errors, EditMethodResolver $resolver): JsonResponse
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
        $sort = $request->validated('sort') ?? [];
        foreach ($sort as $i => $s) {
            if (! in_array($s['column'], $names, true)) {
                throw ValidationException::withMessages(["sort.{$i}.column" => 'Unknown column.']);
            }
        }
        $page = (int) $request->validated('page', 1);
        $perPage = (int) $request->validated('per_page', 100);

        try {
            $data = $factory->using($connection, function (Connection $db) use ($connection, $snapshot, $drivers, $info, $filters, $sort, $page, $perPage, $resolver) {
                $plan = $this->editPlan($resolver, $connection, $snapshot, $info, $db);

                return TableRowsQuery::run($db, $drivers->for($connection->driver), $info, $filters, $sort, $page, $perPage, $plan);
            }, (int) config('dbsuperb.query_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($errors->map($e));
        }

        return response()->json($data + ['page' => $page, 'per_page' => $perPage]);
    }

    /**
     * How rows of the table are pinned for editing. Resolving runs a few catalogue queries (tens of milliseconds on
     * MySQL/MariaDB), so the plan is cached per snapshot: a schema refresh stores a new snapshot and so a new plan.
     * Connection settings (read-only, schema) are part of the key. A plan that can't be resolved leaves the table
     * read-only for this request and isn't cached.
     */
    private function editPlan(EditMethodResolver $resolver, SavedConnection $connection, StoredSnapshot $snapshot, array $info, Connection $db): EditPlan
    {
        $key = 'edit-plan:'.$connection->id.':'.$snapshot->id.':'.sha1(json_encode([$info['name'], $connection->read_only, $connection->options, $connection->updated_at?->toIso8601String()]));
        $cached = Cache::get($key);
        if (is_array($cached)) {
            return EditPlan::fromArray($cached);
        }

        try {
            $plan = $resolver->resolve($connection, $info, $db);
        } catch (Throwable $e) {
            report($e);

            return EditPlan::none('the database did not say how to identify rows');
        }
        Cache::put($key, $plan->toArray(), now()->addDay());

        return $plan;
    }
}
