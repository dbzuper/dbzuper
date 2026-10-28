<?php

namespace App\Database\Sql;

final readonly class Classification
{
    /** @param 'read'|'write'|'ddl'|'destructive'|'transaction'|'session' $kind */
    public function __construct(public string $kind, public string $keyword, public ?string $target = null) {}

    /** @return array{kind: string, keyword: string, target: ?string} */
    public function toArray(): array
    {
        return ['kind' => $this->kind, 'keyword' => $this->keyword, 'target' => $this->target];
    }
}
