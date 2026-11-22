<?php

namespace App\Http\Controllers\Api;

use App\Database\ConnectionFactory;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Schema\SnapshotService;
use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\StartExportRequest;
use App\Jobs\RunExport;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Models\User;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\DumpObject;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Export\ObjectLister;
use App\Transfers\Native\NativeExporter;
use App\Transfers\TransferConflict;
use App\Transfers\TransferPlanner;
use App\Transfers\TransferStarter;
use App\Transfers\TransferStorage;
use Illuminate\Database\Connection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Throwable;

class TransferController extends Controller
{
    public function capabilities(Request $request, SavedConnection $connection, TransferPlanner $planner): JsonResponse
    {
        Gate::authorize('view', $connection);
        $tables = $request->query('tables');
        $keys = is_array($tables) ? array_values(array_filter($tables, 'is_string')) : null;

        return response()->json($planner->capabilities($connection, $keys));
    }

    public function objects(SavedConnection $connection, ConnectionFactory $factory, DbErrorMapper $errors, SnapshotService $snapshots): JsonResponse
    {
        Gate::authorize('view', $connection);

        $objects = $this->listObjects($connection, $factory, $errors);

        // A snapshot covers one schema: the connection's, or "public" for PostgreSQL.
        $snapshotSchema = (string) (($connection->options ?? [])['schema'] ?? 'public');
        $rows = [];
        foreach ($snapshots->current($connection)->payload['tables'] as $table) {
            $rows[$table['name']] = $table['kind'] === 'table' ? ($table['row_count']['count'] ?? null) : null;
        }

        return response()->json(['objects' => array_map(
            fn (DumpObject $o): array => $o->toArray() + [
                'rows' => $o->kind === 'table' && ($o->schema === null || $o->schema === $snapshotSchema) ? ($rows[$o->name] ?? null) : null,
            ],
            $objects,
        )]);
    }

    /** This user's recent transfers for this connection and database, newest first. */
    public function index(Request $request, SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);
        TransferStorage::prune();

        $transfers = $this->scope($request, $connection)->orderByDesc('created_at')->orderByDesc('id')->limit(10)->get();

        return response()->json(['transfers' => $transfers->map(fn (Transfer $t) => $t->toApiArray())->all()]);
    }

    public function export(
        StartExportRequest $request,
        SavedConnection $connection,
        TransferPlanner $planner,
        ConnectionFactory $factory,
        DbErrorMapper $errors,
        BuiltinExporters $builtin,
        NativeExporter $native,
    ): JsonResponse {
        Gate::authorize('view', $connection);
        $options = ExportOptions::fromRequest($request->validated());

        if ($options->tables !== null) {
            $keys = array_map(fn (DumpObject $o) => $o->key(), $this->listObjects($connection, $factory, $errors));
            $missing = array_values(array_diff($options->tables, $keys));
            if ($options->tables === [] || $missing !== []) {
                throw ValidationException::withMessages(['tables' => $options->tables === []
                    ? 'Choose at least one table.'
                    : 'These tables no longer exist: '.implode(', ', array_slice($missing, 0, 5)).(count($missing) > 5 ? ', …' : '')]);
            }
        }

        $requested = $request->validated('method');
        [$method, $check] = $planner->resolve($connection, TransferDirection::Export, is_string($requested) ? TransferMethod::from($requested) : null);
        $warnings = $method === TransferMethod::Native
            ? $native->gapsFor($connection, $options->tables)
            : $builtin->for($connection->driver)->gaps();

        /** @var User $user */
        $user = $request->user();

        try {
            $transfer = TransferStarter::start(
                $connection,
                $user,
                TransferDirection::Export,
                $method,
                [...$options->toArray(), 'method_reason' => $check->reason],
                $this->fileName($connection, $planner, $options->gzip),
                null,
            );
        } catch (TransferConflict $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }

        $transfer->forceFill(['warnings' => $warnings])->save();
        RunExport::dispatch($transfer->id);

        return response()->json($transfer->toApiArray(), 202);
    }

    public function show(Request $request, SavedConnection $connection, string $transfer): JsonResponse
    {
        return response()->json($this->find($request, $connection, $transfer)->toApiArray());
    }

    /** A queued transfer is cancelled at once; a running one is asked to stop and ends at its next check. */
    public function cancel(Request $request, SavedConnection $connection, string $transfer): JsonResponse
    {
        $found = $this->find($request, $connection, $transfer);

        if ($found->status->isActive()) {
            Transfer::query()->whereKey($found->id)->whereNull('cancel_requested_at')->update(['cancel_requested_at' => now()]);
            // Only while still Pending: a worker that has just picked it up sees the flag instead.
            Transfer::query()->whereKey($found->id)->where('status', TransferStatus::Pending)
                ->update(['status' => TransferStatus::Cancelled, 'finished_at' => now()]);
        }

        return response()->json($found->refresh()->toApiArray());
    }

    /** The backup file, streamed with Range support so an interrupted download can resume. */
    public function download(Request $request, SavedConnection $connection, string $transfer): BinaryFileResponse
    {
        $found = $this->find($request, $connection, $transfer);
        $path = (string) $found->file_path;
        abort_unless($found->isDownloadable() && is_file($path), 404);

        return response()->download($path, (string) $found->file_name, [
            'Content-Type' => str_ends_with((string) $found->file_name, '.gz') ? 'application/gzip' : 'application/sql',
        ]);
    }

    /** @return list<DumpObject> */
    private function listObjects(SavedConnection $connection, ConnectionFactory $factory, DbErrorMapper $errors): array
    {
        try {
            return $factory->using($connection, fn (Connection $db): array => ObjectLister::list($db, $connection->driver), (int) config('dbzuper.query_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($errors->map($e));
        }
    }

    /** @return Builder<Transfer> */
    private function scope(Request $request, SavedConnection $connection): Builder
    {
        return Transfer::query()
            ->where('user_id', $request->user()?->getAuthIdentifier())
            ->where('saved_connection_id', $connection->getKey())
            ->where('database', $connection->storageDatabase());
    }

    /** The transfer, when it belongs to this user, connection and database; otherwise 404. */
    private function find(Request $request, SavedConnection $connection, string $id): Transfer
    {
        Gate::authorize('view', $connection);

        return $this->scope($request, $connection)->whereKey($id)->firstOrFail();
    }

    /** "{database}-{YYYYMMDD-HHmmss}.sql[.gz]" in the app timezone; SQLite uses the file name without its extension. */
    private function fileName(SavedConnection $connection, TransferPlanner $planner, bool $gzip): string
    {
        $name = $planner->databaseName($connection);
        if ($connection->driver === DriverName::Sqlite) {
            $name = pathinfo($name, PATHINFO_FILENAME);
        }
        // Characters no file system or Content-Disposition header takes.
        $name = trim((string) preg_replace('~[\x00-\x1F\x7F/\\\\:*?"<>|]+~u', '_', $name));

        return ($name === '' ? 'database' : $name).'-'.now()->timezone((string) config('app.timezone'))->format('Ymd-His').'.sql'.($gzip ? '.gz' : '');
    }
}
