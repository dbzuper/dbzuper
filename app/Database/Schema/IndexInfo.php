<?php

namespace App\Database\Schema;

final readonly class IndexInfo
{
    /** @param list<string> $columns */
    public function __construct(public string $name, public array $columns, public bool $unique, public bool $primary) {}

    public function toArray(): array
    {
        return ['name' => $this->name, 'columns' => $this->columns, 'unique' => $this->unique, 'primary' => $this->primary];
    }
}
