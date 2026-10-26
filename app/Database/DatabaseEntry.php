<?php

namespace App\Database;

/** One database on a server, as the database list shows it. Counts and sizes are null when unknown. */
final readonly class DatabaseEntry
{
    public function __construct(
        public string $name,
        public bool $system,
        public ?int $tables,
        public ?int $bytes,
        public bool $openable,
    ) {}

    /** @return array{name: string, system: bool, tables: ?int, bytes: ?int, openable: bool} */
    public function toArray(): array
    {
        return ['name' => $this->name, 'system' => $this->system, 'tables' => $this->tables, 'bytes' => $this->bytes, 'openable' => $this->openable];
    }
}
