<?php

namespace App\Database\Schema;

use Carbon\CarbonImmutable;

/**
 * @phpstan-import-type TableArray from TableInfo
 * @phpstan-import-type RelationshipArray from Relationship
 */
final readonly class SchemaSnapshot
{
    /**
     * @param  list<TableInfo>  $tables
     * @param  list<Relationship>  $relationships
     */
    public function __construct(
        public string $driver,
        public string $database,
        public ?string $schema,
        public CarbonImmutable $generatedAt,
        public array $tables,
        public array $relationships,
        public bool $truncated = false,
        public ?int $totalObjects = null,
    ) {}

    public function table(string $name): ?TableInfo
    {
        foreach ($this->tables as $table) {
            if ($table->name === $name) {
                return $table;
            }
        }

        return null;
    }

    /** Hash of structure only: unaffected by row counts, sizes or generation time. */
    public function structureHash(): string
    {
        return sha1(json_encode([
            array_map(fn (TableInfo $t) => $t->toArray(withStats: false), $this->tables),
            array_map(fn (Relationship $r) => $r->toArray(), $this->relationships),
        ], JSON_THROW_ON_ERROR));
    }

    /** @return array{driver: string, database: string, schema: ?string, generated_at: string, hash: string, tables: list<TableArray>, relationships: list<RelationshipArray>, truncated: bool, total_objects: int} */
    public function toArray(): array
    {
        return [
            'driver' => $this->driver,
            'database' => $this->database,
            'schema' => $this->schema,
            'generated_at' => $this->generatedAt->toIso8601String(),
            'hash' => $this->structureHash(),
            'tables' => array_map(fn (TableInfo $t) => $t->toArray(), $this->tables),
            'relationships' => array_map(fn (Relationship $r) => $r->toArray(), $this->relationships),
            'truncated' => $this->truncated,
            'total_objects' => $this->totalObjects ?? count($this->tables),
        ];
    }
}
