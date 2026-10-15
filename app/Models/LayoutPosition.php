<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LayoutPosition extends Model
{
    protected $table = 'layout_positions';

    protected $fillable = ['connection_id', 'payload'];

    protected function casts(): array
    {
        return ['payload' => 'array'];
    }
}
