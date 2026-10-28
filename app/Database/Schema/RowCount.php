<?php

namespace App\Database\Schema;

/** @phpstan-type RowCountArray array{count: ?int, kind: string} */
final readonly class RowCount
{
    /** @param 'exact'|'estimate'|'at_least'|'unknown' $kind */
    public function __construct(public ?int $count, public string $kind) {}

    public static function unknown(): self
    {
        return new self(null, 'unknown');
    }

    /** @return RowCountArray */
    public function toArray(): array
    {
        return ['count' => $this->count, 'kind' => $this->kind];
    }
}
