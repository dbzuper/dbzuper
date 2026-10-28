<?php

namespace App\Models;

use App\Database\Schema\SchemaSnapshot;
use Illuminate\Database\Eloquent\Model;

/**
 * @phpstan-import-type SnapshotArray from SchemaSnapshot
 *
 * @property SnapshotArray $payload  stored by SnapshotService from SchemaSnapshot::toArray()
 */
class StoredSnapshot extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'schema_snapshots';

    protected $fillable = ['connection_id', 'hash', 'payload', 'table_count', 'view_count', 'preview', 'server_info'];

    protected function casts(): array
    {
        return ['payload' => 'array', 'preview' => 'array', 'server_info' => 'array', 'table_count' => 'integer', 'view_count' => 'integer', 'created_at' => 'immutable_datetime'];
    }

    /** @return array{snapshot: SnapshotArray, snapshot_id: int, stored_at: string, server: ?array<string, mixed>} */
    public function toApiArray(): array
    {
        return [
            'snapshot' => $this->payload,
            'snapshot_id' => $this->id,
            'stored_at' => $this->created_at->toIso8601String(),
            'server' => $this->server_info,
        ];
    }
}
