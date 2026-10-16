<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PinnedTable extends Model
{
    protected $table = 'pinned_tables';

    protected $fillable = ['user_id', 'connection_id', 'table_name', 'position'];

    /** @return array{id: int, table: string, position: int} */
    public function toClientArray(): array
    {
        return ['id' => $this->id, 'table' => $this->table_name, 'position' => $this->position];
    }
}
