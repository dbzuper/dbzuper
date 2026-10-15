<?php

namespace App\Database\Query;

use App\Database\Errors\DbError;
use App\Database\Sql\Classification;

final class StatementResult
{
    /**
     * @param  list<array{name: string, type: ?string, table: ?string}>  $columns
     * @param  list<list<string|int|float|bool|null>>  $rows
     */
    public function __construct(
        public readonly string $sql,
        public readonly Classification $classification,
        public readonly array $columns,
        public readonly array $rows,
        public readonly bool $truncated,
        public readonly ?int $affected,
        public readonly int $durationMs,
        public readonly ?DbError $error = null,
        public readonly int $bytes = 0,
    ) {}

    public static function failed(string $sql, Classification $classification, DbError $error, int $durationMs): self
    {
        return new self($sql, $classification, [], [], false, null, $durationMs, $error);
    }

    public function toArray(): array
    {
        return [
            'sql' => $this->sql,
            'kind' => $this->classification->kind,
            'columns' => $this->columns,
            'rows' => $this->rows,
            'truncated' => $this->truncated,
            'affected' => $this->affected,
            'duration_ms' => $this->durationMs,
            'error' => $this->error?->toArray(),
        ];
    }
}
