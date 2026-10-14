<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StoredSnapshot extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'schema_snapshots';

    protected $fillable = ['connection_id', 'hash', 'payload'];

    protected function casts(): array
    {
        return ['payload' => 'array', 'created_at' => 'immutable_datetime'];
    }

    public function toApiArray(): array
    {
        return ['snapshot' => $this->payload, 'snapshot_id' => $this->id, 'stored_at' => $this->created_at->toIso8601String()];
    }
}
