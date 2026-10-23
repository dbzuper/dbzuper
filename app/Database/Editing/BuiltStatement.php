<?php

namespace App\Database\Editing;

/**
 * One statement of a change set, ready to run: `sql` has `?` placeholders for `bindings` (strings, SQLite integers and
 * floats, or null), `previewSql` is the same statement with the literals inlined by the connection, for the Review dialog.
 * UPDATE and DELETE must match exactly one row; INSERT adds one.
 */
final readonly class BuiltStatement
{
    /** @param list<string|int|float|null> $bindings */
    public function __construct(
        public int $index,
        public string $op,
        public string $sql,
        public array $bindings,
        public string $previewSql,
        public string $target,
    ) {}

    /** @return array{index: int, op: string, sql: string, target: string} */
    public function toPreview(): array
    {
        return ['index' => $this->index, 'op' => $this->op, 'sql' => $this->previewSql, 'target' => $this->target];
    }
}
