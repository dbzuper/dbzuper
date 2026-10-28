<?php

namespace App\Http\Controllers\Api;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Editing\BuiltStatement;
use App\Database\Editing\ChangeFailed;
use App\Database\Editing\ChangeSetBuilder;
use App\Database\Editing\ChangeSetRejected;
use App\Database\Editing\ChangeSetRunner;
use App\Database\Editing\EditMethodResolver;
use App\Database\Editing\EditPlanCache;
use App\Database\Editing\RowMismatch;
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

/**
 * Builds a table's change set from the snapshot (spec §7). In preview mode it returns the statements unrun; otherwise
 * it commits them in one transaction, each affecting exactly one row (409 row_mismatch / 422 with the change's index).
 */
class TableChangesController extends Controller
{
    public function __invoke(TableChangesRequest $request, SavedConnection $connection, string $table, SnapshotService $snapshots, ConnectionFactory $factory, DriverRegistry $drivers, DbErrorMapper $errors, EditPlanCache $plans, ChangeSetBuilder $builder, ChangeSetRunner $runner): JsonResponse
    {
        // Same ability as running SQL on the connection: the owner may read and write through it.
        Gate::authorize('view', $connection);
        abort_if($connection->read_only, 403, EditMethodResolver::READ_ONLY_REASON);
        $snapshot = $snapshots->current($connection);
        $info = $snapshot->table($table);
        abort_if($info === null, 404);
        $changes = $request->changes();
        $preview = $request->boolean('preview');

        try {
            // The connection resolves the plan (when not cached), quotes the preview's literals and runs the commit.
            // Committing counts matched rows, so an UPDATE to the same value is still its one row on MySQL/MariaDB.
            $outcome = $factory->using($connection, function (Connection $db) use ($connection, $snapshot, $info, $drivers, $plans, $builder, $runner, $changes, $preview) {
                $statements = $builder->build($plans->for($connection, $snapshot, $info, $db), $info, $drivers->for($connection->driver), $db, $changes);

                return $preview
                    ? ['statements' => array_map(fn (BuiltStatement $s) => $s->toPreview(), $statements)]
                    : ['applied' => $runner->commit($connection, $db, $statements)];
            }, (int) config('dbzuper.query_timeout'), countMatchedRows: ! $preview);
        } catch (ChangeSetRejected $e) {
            throw ValidationException::withMessages([$e->field => $e->getMessage()]);
        } catch (RowMismatch|ChangeFailed $e) {
            // Already shaped (409 / 422 with the change's index): keep them out of the generic database-error catch below.
            throw $e;
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($errors->map($e));
        }

        return response()->json($outcome);
    }
}
