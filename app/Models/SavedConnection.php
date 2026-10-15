<?php

namespace App\Models;

use App\Enums\DriverName;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class SavedConnection extends Model
{
    use HasFactory;

    protected $table = 'connections';

    protected $fillable = [
        'name', 'driver', 'host', 'port', 'database', 'username', 'password',
        'options', 'read_only', 'color', 'store_history',
    ];

    protected $hidden = ['password'];

    protected function casts(): array
    {
        return [
            'driver' => DriverName::class,
            'port' => 'integer',
            'password' => 'encrypted',
            'options' => 'encrypted:array',
            'read_only' => 'boolean',
            'store_history' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Safe representation for the browser: never includes the password. */
    public function snapshots(): HasMany
    {
        return $this->hasMany(StoredSnapshot::class, 'connection_id');
    }

    public function layout(): HasOne
    {
        return $this->hasOne(LayoutPosition::class, 'connection_id');
    }

    public function toClientArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'driver' => $this->driver->value,
            'driver_label' => $this->driver->label(),
            'host' => $this->host,
            'port' => $this->port,
            'database' => $this->database,
            'username' => $this->username,
            'has_password' => filled($this->password),
            'options' => $this->options ?? [],
            'read_only' => $this->read_only,
            'color' => $this->color,
            'store_history' => $this->store_history,
        ];
    }
}
