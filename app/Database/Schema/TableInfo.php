<?php

namespace App\Database\Schema;

/**
 * @phpstan-import-type ColumnArray from ColumnInfo
 * @phpstan-import-type IndexArray from IndexInfo
 * @phpstan-import-type RowCountArray from RowCount
 *
 * @phpstan-type TableArray array{name: string, kind: string, row_count?: RowCountArray, size_bytes?: ?int, primary_key: list<string>, columns: list<ColumnArray>, indexes: list<IndexArray>}
 */
final readonly class TableInfo
{
    /**
     * @param  'table'|'view'  $kind
     * @param  list<ColumnInfo>  $columns
     * @param  list<string>  $primaryKey
     * @param  list<IndexInfo>  $indexes
     */
    public function __construct(
        public string $name,
        public string $kind,
        public RowCount $rowCount,
        public ?int $sizeBytes,
        public array $columns,
        public array $primaryKey,
        public array $indexes,
    ) {}

    public function column(string $name): ?ColumnInfo
    {
        foreach ($this->columns as $column) {
            if ($column->name === $name) {
                return $column;
            }
        }

        return null;
    }

    /** @return TableArray */
    public function toArray(bool $withStats = true): array
    {
        return array_merge(
            ['name' => $this->name, 'kind' => $this->kind],
            $withStats ? ['row_count' => $this->rowCount->toArray(), 'size_bytes' => $this->sizeBytes] : [],
            [
                'primary_key' => $this->primaryKey,
                'columns' => array_map(fn (ColumnInfo $c) => $c->toArray(), $this->columns),
                'indexes' => array_map(fn (IndexInfo $i) => $i->toArray(), $this->indexes),
            ],
        );
    }
}
