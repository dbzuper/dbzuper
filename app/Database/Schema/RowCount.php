<?php

namespace App\Database\Schema;

final readonly class RowCount
{
    /** @param 'exact'|'estimate'|'at_least'|'unknown' $kind */
    public function __construct(public ?int $count, public string $kind) {}

    public static function unknown(): self
    {
        return new self(null, 'unknown');
    }

    public function toArray(): array
    {
        return ['count' => $this->count, 'kind' => $this->kind];
    }
}
