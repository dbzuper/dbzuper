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
use App\Http\Requests\StartImportRequest;
use App\Jobs\RunExport;
use App\Jobs\RunImport;
use App\Jobs\TransferJob;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Models\User;
use App\Support\BrowserTimezone;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\DumpObject;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Export\ObjectLister;
use App\Transfers\Native\NativeExporter;
use App\Transfers\TransferConflict;
use App\Transfers\TransferPlanner;
use App\Transfers\TransferStarter;
use App\Transfers\TransferStorage;
use App\Transfers\TransferTarget;
use Illuminate\Database\Connection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Throwable;

class TransferController extends Controller
{
    /** The largest upload chunk taken in one request (8 MiB); the browser sends 4 MiB. */
    public const CHUNK_MAX_BYTES = 8 * 1024 * 1024;

    /** The upload's file inside the transfer's directory. */
    private const UPLOAD_FILE = 'upload';

    public function capabilities(Request $request, SavedConnection $connection, TransferPlanner $planner): JsonResponse
    {
        Gate::authorize('view', $connection);
        if ($request->isMethod('post')) {
            // JSON body: {tables: 'all' | list<string>}.
            $tables = $request->json('tables', 'all');
            $valid = $tables === 'all' || (is_array($tables) && array_is_list($tables)
                && array_filter($tables, fn ($t) => ! is_string($t) || $t === '' || strlen($t) > 1000) === []);
            if (! $valid) {
                throw ValidationException::withMessages(['tables' => "Choose 'all' or a list of tables."]);
            }
            $keys = $tables === 'all' ? null : $tables;
        } else {
            $tables = $request->query('tables');
            $keys = is_array($tables) ? array_values(array_filter($tables, 'is_string')) : null;
        }
        if ($keys !== null && count($keys) > StartExportRequest::MAX_TABLES) {
            throw ValidationException::withMessages(['tables' => StartExportRequest::TOO_MANY_TABLES]);
        }

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
        // The dialog polls this list: the cleanup runs at most once a minute (starting a transfer always runs it).
        if (Cache::add('dbzuper.transfers.pruned', true, 60)) {
            TransferStorage::prune();
        }

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
                [...$options->toArray(), 'method_reason' => $check->reason, 'target' => TransferTarget::fingerprint($connection)],
                $this->fileName($connection, $planner, $options->gzip, $request->input('timezone')),
                null,
            );
        } catch (TransferConflict $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }

        $transfer->forceFill(['warnings' => $warnings])->save();
        if (($failed = $this->queue($transfer, new RunExport($transfer->id))) !== null) {
            return $failed;
        }

        return response()->json($transfer->toApiArray(), 202);
    }

    /**
     * Starts a restore into the open database. The transfer waits in Uploading until upload() has every byte; the
     * method is decided now, and the job fails rather than switch if it can no longer be used by then.
     */
    public function import(StartImportRequest $request, SavedConnection $connection, TransferPlanner $planner): JsonResponse
    {
        $requested = $request->validated('method');
        [$method, $check] = $planner->resolve($connection, TransferDirection::Import, is_string($requested) ? TransferMethod::from($requested) : null);

        /** @var User $user */
        $user = $request->user();

        try {
            $transfer = TransferStarter::start(
                $connection,
                $user,
                TransferDirection::Import,
                $method,
                ['method_reason' => $check->reason, 'target' => TransferTarget::fingerprint($connection)],
                $request->fileName(),
                (int) $request->validated('size'),
                TransferStatus::Uploading,
            );
        } catch (TransferConflict $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }

        // Saved before the file exists, so every cleanup path knows about it.
        $path = TransferStorage::directory($transfer).DIRECTORY_SEPARATOR.self::UPLOAD_FILE;
        $transfer->forceFill(['file_path' => $path])->save();
        touch($path);

        return response()->json($transfer->toApiArray(), 201);
    }

    /**
     * Appends one chunk of the restore file (the raw request body) at the offset in the Upload-Offset header. A chunk
     * sent at any other offset than the file's current size (a retry after a dropped connection) gets 409 with that
     * size, and the browser resumes from there. The last byte moves the transfer to Pending and queues the restore.
     */
    public function upload(Request $request, SavedConnection $connection, string $transfer): JsonResponse
    {
        $found = $this->find($request, $connection, $transfer);

        $header = $request->header('Upload-Offset');
        if (! is_string($header) || preg_match('/^\d{1,18}$/', $header) !== 1) {
            return response()->json(['message' => 'The Upload-Offset header must be a byte offset.'], 422);
        }
        $offset = (int) $header;

        // Raw bytes only: a form or JSON body would be parsed into memory by the framework.
        $type = $request->headers->get('Content-Type');
        if ($type !== null && $type !== '' && strtolower(trim(explode(';', $type)[0])) !== 'application/octet-stream') {
            return response()->json(['message' => 'Send upload chunks as application/octet-stream.'], 415);
        }

        $length = $request->header('Content-Length');
        if (is_numeric($length) && (int) $length > self::CHUNK_MAX_BYTES) {
            return $this->chunkTooLarge();
        }

        if ($found->status !== TransferStatus::Uploading || ! filled($found->file_path)) {
            return $this->notUploading($found);
        }

        $file = @fopen((string) $found->file_path, 'c+b');
        if ($file === false) {
            return $this->notUploading($found->refresh());
        }

        $total = (int) $found->bytes_total;

        try {
            // One chunk at a time per upload: a retry racing the original request waits, then sees the new size.
            flock($file, LOCK_EX);
            if ($found->refresh()->status !== TransferStatus::Uploading) {
                return $this->notUploading($found);
            }

            // The file's size, with the position left at its end for the append.
            $current = fseek($file, 0, SEEK_END) === 0 ? ftell($file) : false;
            if ($current === false) {
                throw new RuntimeException("Couldn't read the upload's size.");
            }
            if ($offset !== $current) {
                return $this->conflict("The upload is at byte {$current}.", TransferStatus::Uploading, $current);
            }

            $allowed = min(self::CHUNK_MAX_BYTES, $total - $current);
            // Streamed from the request into the file, never held in memory. Copying one byte more than allowed
            // tells an oversized chunk, which is then cut off again.
            $written = (int) stream_copy_to_stream($request->getContent(true), $file, $allowed + 1);
            fflush($file);

            if ($written > $allowed) {
                ftruncate($file, max(0, $current)); // a file size, never negative

                return $written > self::CHUNK_MAX_BYTES
                    ? $this->chunkTooLarge()
                    : response()->json(['message' => 'The file is larger than the size given when the upload started.', 'offset' => $current], 422);
            }
            $offset = $current + $written;
        } finally {
            flock($file, LOCK_UN);
            fclose($file);
        }

        if ($offset < $total) {
            // Also keeps updated_at fresh, so the cleanup doesn't take a slow upload for an abandoned one.
            $saved = Transfer::query()->whereKey($found->id)->where('status', TransferStatus::Uploading)->update(['bytes_done' => $offset]);

            return $saved === 1
                ? response()->json(['offset' => $offset, 'status' => TransferStatus::Uploading->value])
                : $this->notUploading($found->refresh());
        }

        // bytes_done counts again from 0 as the restore reads the file.
        $queued = Transfer::query()->whereKey($found->id)->where('status', TransferStatus::Uploading)
            ->update(['status' => TransferStatus::Pending, 'bytes_done' => 0]);
        if ($queued !== 1) {
            return $this->notUploading($found->refresh());
        }

        if (($failed = $this->queue($found->refresh(), new RunImport($found->id))) !== null) {
            return $failed;
        }

        return response()->json(['offset' => $offset, 'status' => TransferStatus::Pending->value]);
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
            // Only while still uploading or queued: a worker that has just picked it up sees the flag instead.
            $stopped = Transfer::query()->whereKey($found->id)
                ->whereIn('status', [TransferStatus::Uploading->value, TransferStatus::Pending->value])
                ->update(['status' => TransferStatus::Cancelled, 'finished_at' => now()]);
            if ($stopped === 1) {
                $this->deleteUpload($found->refresh());
            }
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

    /**
     * Queues the job. When that fails the transfer is failed with the reason, so it doesn't hold the database's one
     * active transfer slot forever, and the response says why.
     */
    private function queue(Transfer $transfer, TransferJob $job): ?JsonResponse
    {
        try {
            Bus::dispatch($job);

            return null;
        } catch (Throwable $e) {
            report($e);
            $message = "Couldn't queue the job: ".$e->getMessage();
            $transfer->forceFill(['status' => TransferStatus::Failed, 'error' => $message, 'finished_at' => now()])->save();
            $this->deleteUpload($transfer);

            return response()->json(['message' => $message], 503);
        }
    }

    /** Removes a restore's uploaded file. When it can't be removed yet, file_path stays so the cleanup retries later. */
    private function deleteUpload(Transfer $transfer): void
    {
        if ($transfer->direction !== TransferDirection::Import || $transfer->file_path === null) {
            return;
        }

        TransferStorage::deleteFiles($transfer);
        if (! file_exists($transfer->file_path)) {
            $transfer->forceFill(['file_path' => null])->save();
        }
    }

    private function notUploading(Transfer $transfer): JsonResponse
    {
        // A chunk that raced a cancel or the abandoned-upload cleanup may have recreated the file.
        if ($transfer->status->isFinished()) {
            $this->deleteUpload($transfer);
        }

        // Pending, Running or Done: every byte arrived (a retried last chunk lands here), so the offset is the size.
        $complete = in_array($transfer->status, [TransferStatus::Pending, TransferStatus::Running, TransferStatus::Done], true);

        return $this->conflict('This upload is no longer accepting data.', $transfer->status, $complete ? (int) $transfer->bytes_total : null);
    }

    /** Every 409 of the upload: {message, status, offset?}. offset is given whenever the client has a byte to resume from. */
    private function conflict(string $message, TransferStatus $status, ?int $offset): JsonResponse
    {
        return response()->json(array_filter(
            ['message' => $message, 'status' => $status->value, 'offset' => $offset],
            fn ($v) => $v !== null,
        ), 409);
    }

    private function chunkTooLarge(): JsonResponse
    {
        return response()->json(['message' => 'An upload chunk can be at most 8 MB.'], 413);
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

    /**
     * "{database}-{YYYYMMDD-HHmmss}.sql[.gz]" in the browser's timezone (the time the user's own clock showed, as in
     * the Recent list), else the app timezone; SQLite uses the file name without its extension. The browser's zone is
     * not validated: any name PHP knows, or ICU maps to one (legacy ones like Asia/Calcutta), is used, anything else is
     * ignored, so a backup never fails over it.
     */
    private function fileName(SavedConnection $connection, TransferPlanner $planner, bool $gzip, mixed $timezone = null): string
    {
        $name = $planner->databaseName($connection);
        if ($connection->driver === DriverName::Sqlite) {
            $name = pathinfo($name, PATHINFO_FILENAME);
        }
        // Characters no file system or Content-Disposition header takes.
        $name = trim((string) preg_replace('~[\x00-\x1F\x7F/\\\\:*?"<>|]+~u', '_', $name));

        $zone = BrowserTimezone::resolve($timezone) ?? (string) config('app.timezone');

        return ($name === '' ? 'database' : $name).'-'.now()->timezone($zone)->format('Ymd-His').'.sql'.($gzip ? '.gz' : '');
    }
}
