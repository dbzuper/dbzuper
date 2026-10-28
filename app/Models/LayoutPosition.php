<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** @property list<array{table: string, x: float, y: float, pinned: bool}> $payload  written by LayoutController from validated positions */
class LayoutPosition extends Model
{
    protected $table = 'layout_positions';

    protected $fillable = ['connection_id', 'payload'];

    protected function casts(): array
    {
        return ['payload' => 'array'];
    }
}
