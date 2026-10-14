<?php

namespace App\Database\Schema;

final readonly class Relationship
{
    /**
     * @param  list<string>  $fromColumns
     * @param  list<string>  $toColumns
     */
    public function __construct(
        public string $id,
        public string $fromTable,
        public array $fromColumns,
        public string $toTable,
        public array $toColumns,
        public bool $inferred,
        public float $confidence,
        public ?string $name,
    ) {}

    public static function declared(string $fromTable, array $fromColumns, string $toTable, array $toColumns, ?string $name): self
    {
        return new self(self::makeId('fk', $fromTable, $fromColumns, $toTable, $toColumns),
            $fromTable, array_values($fromColumns), $toTable, array_values($toColumns), false, 1.0, $name);
    }

    public static function makeId(string $prefix, string $fromTable, array $fromColumns, string $toTable, array $toColumns): string
    {
        return sprintf('%s:%s(%s)->%s(%s)', $prefix, $fromTable, implode(',', $fromColumns), $toTable, implode(',', $toColumns));
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id, 'from_table' => $this->fromTable, 'from_columns' => $this->fromColumns,
            'to_table' => $this->toTable, 'to_columns' => $this->toColumns,
            'inferred' => $this->inferred, 'confidence' => $this->confidence, 'name' => $this->name,
        ];
    }
}
