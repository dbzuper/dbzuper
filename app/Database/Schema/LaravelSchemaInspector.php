<?php

namespace App\Database\Schema;

use App\Database\Contracts\SchemaInspector;
use App\Models\SavedConnection;
use Carbon\CarbonImmutable;
use Illuminate\Database\Connection;

abstract class LaravelSchemaInspector implements SchemaInspector
{
    public function __construct(private readonly RelationshipInferrer $inferrer) {}

    /** Schema/database to restrict to (MySQL database name, PostgreSQL schema, SQLite "main"). */
    abstract protected function schema(Connection $db, SavedConnection $saved): string;

    /**
     * @param  list<string>  $tables
     * @return array<string, RowCount> keyed by table name
     */
    abstract protected function rowCounts(Connection $db, string $schema, array $tables): array;

    public function inspect(Connection $db, SavedConnection $saved): SchemaSnapshot
    {
        $builder = $db->getSchemaBuilder();
        $schema = $this->schema($db, $saved);

        $rawTables = array_values(array_filter($builder->getTables($schema), fn (array $t) => $this->includeTable($t['name'])));
        $rawViews = $builder->getViews($schema);
        $counts = $this->rowCounts($db, $schema, array_column($rawTables, 'name'));

        $described = $this->describe($db, $schema, array_column($rawTables, 'name'), array_column($rawViews, 'name'));

        $tables = [];
        $declared = [];

        foreach ($rawTables as $raw) {
            $indexes = array_map(
                fn (array $i) => new IndexInfo((string) $i['name'], array_values($i['columns']), (bool) $i['unique'], (bool) $i['primary']),
                $described['indexes'][$raw['name']] ?? [],
            );
            usort($indexes, fn (IndexInfo $a, IndexInfo $b) => strcmp($a->name, $b->name));
            $primary = collect($indexes)->firstWhere('primary', true);

            $tables[] = new TableInfo(
                $raw['name'], 'table',
                $counts[$raw['name']] ?? RowCount::unknown(),
                isset($raw['size']) ? (int) $raw['size'] : null,
                array_map(ColumnInfo::fromLaravel(...), $described['columns'][$raw['name']] ?? []),
                $primary?->columns ?? [],
                $indexes,
            );

            foreach ($described['foreignKeys'][$raw['name']] ?? [] as $fk) {
                if (! $this->sameSchema($fk['foreign_schema'] ?? null, $schema)) {
                    continue; // cross-schema relationships are out of scope for the MVP
                }
                $declared[] = Relationship::declared($raw['name'], $fk['columns'], $fk['foreign_table'], $fk['foreign_columns'], $fk['name'] ?: null);
            }
        }

        foreach ($rawViews as $raw) {
            $tables[] = new TableInfo(
                $raw['name'], 'view', RowCount::unknown(), null,
                array_map(ColumnInfo::fromLaravel(...), $described['columns'][$raw['name']] ?? []),
                [], [],
            );
        }

        usort($tables, fn (TableInfo $a, TableInfo $b) => strcmp($a->name, $b->name));
        $relationships = [...$declared, ...$this->inferrer->infer($tables, $declared)];
        usort($relationships, fn (Relationship $a, Relationship $b) => strcmp($a->id, $b->id));

        return new SchemaSnapshot(
            $saved->driver->value,
            $saved->database,
            $schema,
            CarbonImmutable::now(),
            $tables,
            $relationships,
        );
    }

    /**
     * Columns, indexes and foreign keys for the given tables/views, keyed by name.
     * Default: one Laravel builder call per object (fine for in-process SQLite).
     *
     * @param  list<string>  $tableNames
     * @param  list<string>  $viewNames
     * @return array{columns: array<string, list<array>>, indexes: array<string, list<array>>, foreignKeys: array<string, list<array>>}
     */
    protected function describe(Connection $db, string $schema, array $tableNames, array $viewNames): array
    {
        $builder = $db->getSchemaBuilder();
        $out = ['columns' => [], 'indexes' => [], 'foreignKeys' => []];

        foreach ([...$tableNames, ...$viewNames] as $name) {
            $out['columns'][$name] = $builder->getColumns($this->qualify($schema, $name));
        }
        foreach ($tableNames as $name) {
            $qualified = $this->qualify($schema, $name);
            $out['indexes'][$name] = $builder->getIndexes($qualified);
            $out['foreignKeys'][$name] = $builder->getForeignKeys($qualified);
        }

        return $out;
    }

    /**
     * @param  list<object>  $rows  rows carrying a `table_name` property
     * @param  callable(list<object>): list<array>  $process  a Laravel post-processor method
     * @return array<string, list<array>>
     */
    protected function groupByTable(array $rows, callable $process): array
    {
        $grouped = [];
        foreach ($rows as $row) {
            $grouped[$row->table_name][] = $row;
        }

        return array_map(fn (array $group) => $process($group), $grouped);
    }

    /** Whether a foreign key's target schema is the inspected one (null means the same schema). */
    protected function sameSchema(?string $foreign, string $schema): bool
    {
        return $foreign === null || $foreign === $schema;
    }

    protected function includeTable(string $name): bool
    {
        return true;
    }

    protected function qualify(string $schema, string $table): string
    {
        return $schema.'.'.$table;
    }
}
