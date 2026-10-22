<?php

namespace App\Http\Controllers\Api;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Editing\BuiltStatement;
use App\Database\Editing\ChangeSetBuilder;
use App\Database\Editing\ChangeSetRejected;
use App\Database\Editing\EditMethodResolver;
use App\Database\Editing\EditPlanCache;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Schema\SnapshotService;
use App\Http\Controllers\Controller;
use App\Http\Requests\TableChangesRequest;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Throwable;

/** Builds a table's change set from the snapshot (spec §7) and, in preview mode, returns the statements unrun. */
class TableChangesController extends Controller
{
    public function __invoke(TableChangesRequest $request, SavedConnection $connection, string $table, SnapshotService $snapshots, ConnectionFactory $factory, DriverRegistry $drivers, DbErrorMapper $errors, EditPlanCache $plans, ChangeSetBuilder $builder): JsonResponse
    {
        // Same ability as running SQL on the connection: the owner may read and write through it.
        Gate::authorize('view', $connection);
        abort_if($connection->read_only, 403, EditMethodResolver::READ_ONLY_REASON);
        $snapshot = $snapshots->current($connection);
        $info = collect($snapshot->payload['tables'] ?? [])->firstWhere('name', $table);
        abort_if($info === null, 404);
        $changes = $request->changes();

        try {
            // The connection resolves the plan (when not cached) and quotes the preview's literals.
            $statements = $factory->using($connection, fn (Connection $db) => $builder->build(
                $plans->for($connection, $snapshot, $info, $db), $info, $drivers->for($connection->driver), $db, $changes,
            ), (int) config('dbsuperb.query_timeout'));
        } catch (ChangeSetRejected $e) {
            throw ValidationException::withMessages([$e->field => $e->getMessage()]);
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($errors->map($e));
        }

        return response()->json(['statements' => array_map(fn (BuiltStatement $s) => $s->toPreview(), $statements)]);
    }
}
