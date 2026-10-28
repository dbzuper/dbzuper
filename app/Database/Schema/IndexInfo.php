<?php

namespace App\Database\Schema;

/** @phpstan-type IndexArray array{name: string, columns: list<string>, unique: bool, primary: bool} */
final readonly class IndexInfo
{
    /** @param list<string> $columns */
    public function __construct(public string $name, public array $columns, public bool $unique, public bool $primary) {}

    /** @return IndexArray */
    public function toArray(): array
    {
        return ['name' => $this->name, 'columns' => $this->columns, 'unique' => $this->unique, 'primary' => $this->primary];
    }
}
