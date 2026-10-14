<?php

namespace App\Database\Schema;

use Illuminate\Support\Str;

final class RelationshipInferrer
{
    private const INTEGER = '/int|serial|integer|numeric|decimal/i';

    private const STRING = '/char|uuid|text|binary/i';

    /**
     * @param list<TableInfo> $tables
     * @param list<Relationship> $declared
     * @return list<Relationship>
     */
    public function infer(array $tables, array $declared): array
    {
        $byName = [];
        foreach ($tables as $table) {
            if ($table->kind === 'table') {
                $byName[strtolower($table->name)] = $table;
            }
        }

        $covered = [];
        foreach ($declared as $relationship) {
            foreach ($relationship->fromColumns as $column) {
                $covered[strtolower($relationship->fromTable.'.'.$column)] = true;
            }
        }

        $result = [];
        foreach ($tables as $table) {
            if ($table->kind !== 'table') {
                continue;
            }

            foreach ($table->columns as $column) {
                if (! preg_match('/^(.+)_id$/i', $column->name, $m) || isset($covered[strtolower($table->name.'.'.$column->name)])) {
                    continue;
                }

                $base = strtolower($m[1]);
                if ($base === 'parent') {
                    // Self reference: the only rule that may point back at the source table.
                    $target = $table;
                    $targetColumn = $this->primaryKeyFor($table, $column);
                    $confidence = 0.7;
                } else {
                    $hit = $this->findTarget($byName, $table, $column, $base);
                    [$target, $targetColumn] = $hit ?? [null, null];
                    $confidence = $targetColumn !== null && strcasecmp($column->typeName, $targetColumn->typeName) === 0 ? 0.9 : 0.75;
                }

                if ($target === null || $targetColumn === null) {
                    continue;
                }

                $result[] = new Relationship(
                    Relationship::makeId('inferred', $table->name, [$column->name], $target->name, [$targetColumn->name]),
                    $table->name, [$column->name], $target->name, [$targetColumn->name], true, $confidence, null,
                );
            }
        }

        return $result;
    }

    /**
     * First valid parent in candidate order (prefixed names first). The source table is never a
     * candidate, and an invalid candidate falls through to the next one rather than ending the search.
     *
     * @param array<string, TableInfo> $byName
     * @return array{0: TableInfo, 1: ColumnInfo}|null
     */
    private function findTarget(array $byName, TableInfo $source, ColumnInfo $column, string $base): ?array
    {
        $candidates = array_unique([Str::plural($base), $base, Str::singular($base)]);

        $sourceName = strtolower($source->name);
        $prefix = str_contains($sourceName, '_') ? strtolower(Str::before($sourceName, '_')).'_' : null;
        if ($prefix !== null) {
            $candidates = [...array_map(fn ($c) => $prefix.$c, $candidates), ...$candidates];
        }

        foreach ($candidates as $candidate) {
            if ($candidate === $sourceName || ! isset($byName[$candidate])) {
                continue;
            }

            $targetColumn = $this->primaryKeyFor($byName[$candidate], $column);
            if ($targetColumn !== null) {
                return [$byName[$candidate], $targetColumn];
            }
        }

        return null;
    }

    /** The target's single primary-key column, when it exists and is type-compatible with $column. */
    private function primaryKeyFor(TableInfo $target, ColumnInfo $column): ?ColumnInfo
    {
        if (count($target->primaryKey) !== 1) {
            return null;
        }

        $targetColumn = $target->column($target->primaryKey[0]);

        return $targetColumn !== null && $this->compatible($column->typeName, $targetColumn->typeName)
            ? $targetColumn
            : null;
    }

    private function compatible(string $a, string $b): bool
    {
        foreach ([self::INTEGER, self::STRING] as $family) {
            if (preg_match($family, $a) && preg_match($family, $b)) {
                return true;
            }
        }

        return false;
    }
}
