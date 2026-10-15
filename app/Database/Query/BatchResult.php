<?php

namespace App\Database\Query;

final class BatchResult
{
    /** @param list<StatementResult> $results */
    public function __construct(
        public readonly array $results,
        public readonly bool $openTransactionRolledBack = false,
    ) {}

    public function toArray(): array
    {
        return [
            'results' => array_map(fn (StatementResult $r) => $r->toArray(), $this->results),
            'open_transaction_rolled_back' => $this->openTransactionRolledBack,
        ];
    }
}
