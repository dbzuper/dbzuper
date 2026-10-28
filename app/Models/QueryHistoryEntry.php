<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class QueryHistoryEntry extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'query_history';

    protected $fillable = ['connection_id', 'sql', 'kind', 'status', 'duration_ms', 'row_count', 'affected', 'error'];

    protected function casts(): array
    {
        return [
            'duration_ms' => 'integer',
            'row_count' => 'integer',
            'affected' => 'integer',
            'created_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsTo<SavedConnection, $this> */
    public function connection(): BelongsTo
    {
        return $this->belongsTo(SavedConnection::class, 'connection_id');
    }

    /** The workspace this entry ran in: see SavedConnection::workspaceRef(). */
    public function workspaceRef(): string
    {
        return $this->database === '' ? (string) $this->connection_id : $this->connection_id.':'.$this->database;
    }

    public function toApiArray(): array
    {
        return [
            'id' => $this->id,
            'sql' => $this->sql,
            'kind' => $this->kind,
            'status' => $this->status,
            'duration_ms' => $this->duration_ms,
            'row_count' => $this->row_count,
            'affected' => $this->affected,
            'error' => $this->error,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
