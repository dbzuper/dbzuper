<?php

namespace App\Models;

use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Transfers\WorkerHeartbeat;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A backup (export) or restore (import) of one database: see docs/superpowers/specs/2026-11-22-dbzuper-backup-restore-design.md. */
class Transfer extends Model
{
    use HasUuids;

    protected $fillable = [
        'user_id', 'saved_connection_id', 'database', 'direction', 'method', 'options', 'status',
        'bytes_done', 'bytes_total', 'rows_done', 'rows_total', 'statements_done', 'current_table',
        'file_name', 'file_path', 'file_size', 'warnings', 'error',
        'worker_host', 'worker_pid', 'cancel_requested_at', 'started_at', 'finished_at', 'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'direction' => TransferDirection::class,
            'method' => TransferMethod::class,
            'status' => TransferStatus::class,
            'options' => 'array',
            'warnings' => 'array',
            'bytes_done' => 'integer',
            'bytes_total' => 'integer',
            'rows_done' => 'integer',
            'rows_total' => 'integer',
            'statements_done' => 'integer',
            'file_size' => 'integer',
            'cancel_requested_at' => 'immutable_datetime',
            'started_at' => 'immutable_datetime',
            'finished_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<SavedConnection, $this> */
    public function connection(): BelongsTo
    {
        return $this->belongsTo(SavedConnection::class, 'saved_connection_id');
    }

    /** The saved connection, scoped to this transfer's database when it belongs to a server-level connection. */
    public function runConnection(): SavedConnection
    {
        $connection = $this->connection()->firstOrFail();

        return $this->database === '' ? $connection : $connection->forDatabase($this->database);
    }

    /** Read from the database every time: the request that cancels runs in another process than the worker. */
    public function cancelRequested(): bool
    {
        return static::query()->whereKey($this->getKey())->whereNotNull('cancel_requested_at')->exists();
    }

    public function isDownloadable(): bool
    {
        return $this->direction === TransferDirection::Export
            && $this->status === TransferStatus::Done
            && filled($this->file_path)
            && ($this->expires_at === null || $this->expires_at->isFuture());
    }

    /**
     * Safe representation for the browser: never includes the file path.
     *
     * @return array<string, mixed>
     */
    public function toApiArray(): array
    {
        return [
            'id' => $this->id,
            'database' => $this->database,
            'direction' => $this->direction->value,
            'method' => $this->method->value,
            'status' => $this->status->value,
            'bytes_done' => $this->bytes_done,
            'bytes_total' => $this->bytes_total,
            'rows_done' => $this->rows_done,
            'rows_total' => $this->rows_total,
            'statements_done' => $this->statements_done,
            'current_table' => $this->current_table,
            'file_name' => $this->file_name,
            'file_size' => $this->file_size,
            'warnings' => $this->warnings ?? [],
            'error' => $this->error,
            'downloadable' => $this->isDownloadable(),
            'cancel_requested_at' => $this->cancel_requested_at?->toIso8601String(),
            'started_at' => $this->started_at?->toIso8601String(),
            'finished_at' => $this->finished_at?->toIso8601String(),
            'expires_at' => $this->expires_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            // Lets the progress display tell "waiting for a free worker" from "no worker running" without another call.
            'worker_alive' => WorkerHeartbeat::alive(),
        ];
    }
}
