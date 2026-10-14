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
                [$target, $confidence] = $base === 'parent'
                    ? [$table, 0.7]
                    : [$this->findTarget($byName, $table->name, $base), null];

                if ($target === null || count($target->primaryKey) !== 1) {
                    continue;
                }

                $targetColumn = $target->column($target->primaryKey[0]);
                if ($targetColumn === null || ! $this->compatible($column->typeName, $targetColumn->typeName)) {
                    continue;
                }

                $confidence ??= strcasecmp($column->typeName, $targetColumn->typeName) === 0 ? 0.9 : 0.75;

                $result[] = new Relationship(
                    Relationship::makeId('inferred', $table->name, [$column->name], $target->name, $target->primaryKey),
                    $table->name, [$column->name], $target->name, $target->primaryKey, true, $confidence, null,
                );
            }
        }

        return $result;
    }

    /** @param array<string, TableInfo> $byName */
    private function findTarget(array $byName, string $sourceTable, string $base): ?TableInfo
    {
        $candidates = array_unique([Str::plural($base), $base, Str::singular($base)]);

        $prefix = str_contains($sourceTable, '_') ? strtolower(Str::before($sourceTable, '_')).'_' : null;
        if ($prefix !== null) {
            $candidates = [...array_map(fn ($c) => $prefix.$c, $candidates), ...$candidates];
        }

        foreach ($candidates as $candidate) {
            if (isset($byName[$candidate])) {
                return $byName[$candidate];
            }
        }

        return null;
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
