<?php

namespace App\Models;

use App\Database\Drivers\DsnValue;
use App\Enums\DriverName;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

class SavedConnection extends Model
{
    use HasFactory;

    protected $table = 'connections';

    protected $fillable = [
        'name', 'driver', 'host', 'port', 'database', 'username', 'password',
        'options', 'read_only', 'color', 'store_history',
    ];

    protected $hidden = ['password'];

    /** The database a server-level connection is scoped to; null for the saved model. Never persisted. */
    private ?string $scopedDatabase = null;

    /** Set on copies that reach the server through a maintenance database; they can't be saved either. */
    private bool $maintenance = false;

    protected function casts(): array
    {
        return [
            'driver' => DriverName::class,
            'port' => 'integer',
            'password' => 'encrypted',
            'options' => 'encrypted:array',
            'read_only' => 'boolean',
            'store_history' => 'boolean',
            'last_opened_at' => 'immutable_datetime',
        ];
    }

    /** A server driver saved without a database: it can open any database on the server. */
    public function isServerLevel(): bool
    {
        return $this->driver->isServer() && ($this->scopedDatabase !== null || $this->maintenance || blank($this->database));
    }

    /**
     * A copy that talks to one database of a server-level connection. It reads and writes that database's snapshots,
     * layout, pins and history, and can't be saved, so the chosen database never reaches the stored connection.
     */
    public function forDatabase(string $database): static
    {
        if (! $this->isServerLevel()) {
            throw new LogicException('Only a server-level connection can be scoped to a database.');
        }

        $scoped = clone $this;
        $scoped->scopedDatabase = $database;
        $scoped->setAttribute('database', $database);
        $scoped->setRelations([]);

        return $scoped;
    }

    /**
     * A copy that connects to a server-level connection's server through $database (see
     * Driver::maintenanceDatabases()) to test it or list its databases. It owns no snapshots, pins or history.
     */
    public function forMaintenance(string $database): static
    {
        if (! $this->isServerLevel()) {
            throw new LogicException('Only a server-level connection has maintenance databases.');
        }

        $copy = clone $this;
        $copy->maintenance = true;
        $copy->setAttribute('database', $database);
        $copy->setRelations([]);

        return $copy;
    }

    public function scopedDatabase(): ?string
    {
        return $this->scopedDatabase;
    }

    /** The `database` value of rows that belong to this workspace: '' for a fixed connection. */
    public function storageDatabase(): string
    {
        return $this->scopedDatabase ?? '';
    }

    /** How the browser addresses this workspace: "5", or "5:shop" for one database of a server-level connection. */
    public function workspaceRef(): string
    {
        return $this->scopedDatabase === null ? (string) $this->getKey() : $this->getKey().':'.$this->scopedDatabase;
    }

    /** Route keys are workspace refs, so a scoped connection links to its own database. */
    public function getRouteKey(): mixed
    {
        return $this->workspaceRef();
    }

    /**
     * Resolves a workspace ref. A database part must match a fixed connection's own database, or name a database
     * a server-level connection may open; anything else is not found.
     */
    public function resolveRouteBinding($value, $field = null): ?self
    {
        if ($field !== null || ! is_string($value) || ! preg_match('/^(\d+)(?::(.*))?$/s', $value, $m)) {
            return $field !== null ? parent::resolveRouteBinding($value, $field) : null;
        }

        $connection = static::query()->find((int) $m[1]);
        $database = $m[2] ?? null;
        if ($connection === null || $database === null) {
            return $connection;
        }

        return $connection->scopedTo($database);
    }

    /**
     * This connection opened on $database: itself when that is its fixed database, a scoped copy for a server-level
     * connection when the name is safe to connect with, otherwise null.
     */
    public function scopedTo(string $database): ?self
    {
        if (! $this->isServerLevel()) {
            return $database === $this->database ? $this : null;
        }

        // No engine allows names this long (MySQL 64, PostgreSQL 63); the per-database columns hold 255.
        if (mb_strlen($database) > 255 || ! DsnValue::isSafeDatabaseName($this->driver, $database)) {
            return null;
        }

        return $this->forDatabase($database);
    }

    public function save(array $options = []): bool
    {
        if ($this->scopedDatabase !== null || $this->maintenance) {
            throw new LogicException('A database-scoped connection cannot be saved.');
        }

        return parent::save($options);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Safe representation for the browser: never includes the password. */
    public function snapshots(): HasMany
    {
        return $this->hasMany(StoredSnapshot::class, 'connection_id')->withAttributes(['database' => $this->storageDatabase()]);
    }

    public function layout(): HasOne
    {
        return $this->hasOne(LayoutPosition::class, 'connection_id')->withAttributes(['database' => $this->storageDatabase()]);
    }

    public function pins(): HasMany
    {
        return $this->hasMany(PinnedTable::class, 'connection_id')->withAttributes(['database' => $this->storageDatabase()]);
    }

    public function history(): HasMany
    {
        return $this->hasMany(QueryHistoryEntry::class, 'connection_id')->withAttributes(['database' => $this->storageDatabase()]);
    }

    /** Records a visit to the workspace; skipped within a minute of the last one, and never touches updated_at. */
    public function markOpened(): void
    {
        $sameDatabase = $this->scopedDatabase === null || $this->last_database === $this->scopedDatabase;
        if ($sameDatabase && $this->last_opened_at?->gt(now()->subMinute())) {
            return;
        }

        // A query update, not save(): a scoped copy must not write its database, and updated_at stays put.
        $values = ['last_opened_at' => now()];
        if ($this->scopedDatabase !== null) {
            $values['last_database'] = $this->scopedDatabase;
        }
        static::query()->whereKey($this->getKey())->toBase()->update($values);
        $this->forceFill($values)->syncOriginalAttributes(array_keys($values));
    }

    public function toClientArray(): array
    {
        return [
            'id' => $this->id,
            'ref' => $this->workspaceRef(),
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
            'last_opened_at' => $this->last_opened_at?->toIso8601String(),
            'server_level' => $this->isServerLevel(),
            'last_database' => $this->last_database,
        ];
    }
}
