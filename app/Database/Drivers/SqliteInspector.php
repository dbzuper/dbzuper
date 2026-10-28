<?php

namespace App\Database\Drivers;

use App\Database\Schema\LaravelSchemaInspector;
use App\Database\Schema\RowCount;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Illuminate\Database\Query\Processors\SQLiteProcessor;
use Illuminate\Database\Schema\Grammars\SQLiteGrammar;
use LogicException;

class SqliteInspector extends LaravelSchemaInspector
{
    protected function schema(Connection $db, SavedConnection $saved): string
    {
        return 'main';
    }

    protected function includeTable(string $name): bool
    {
        return ! str_starts_with($name, 'sqlite_');
    }

    protected function rowCounts(Connection $db, string $schema, array $tables): array
    {
        $cap = (int) config('dbzuper.sqlite_count_cap');

        $counts = [];
        foreach ($tables as $table) {
            $count = (int) $db->selectOne(
                'select count(*) as c from (select 1 from '.'"'.str_replace('"', '""', $table).'"'.' limit '.($cap + 1).') t'
            )->c;
            $counts[$table] = $count > $cap ? new RowCount($cap, 'at_least') : new RowCount($count, 'exact');
        }

        return $counts;
    }

    /**
     * Laravel's schema builder splits "schema.table" on every dot, which breaks table names
     * containing dots; call the grammar with separate schema/table arguments instead. The grammar wraps names in
     * single quotes without escaping them, so a quote inside a name is doubled here.
     */
    protected function describe(Connection $db, string $schema, array $tableNames, array $viewNames): array
    {
        $grammar = $db->getSchemaGrammar();
        $processor = $db->getPostProcessor();
        if (! $grammar instanceof SQLiteGrammar || ! $processor instanceof SQLiteProcessor) {
            throw new LogicException('SqliteInspector needs an SQLite connection.');
        }
        $out = ['columns' => [], 'indexes' => [], 'foreignKeys' => []];

        $literal = fn (string $name) => str_replace("'", "''", $name);

        foreach ([...$tableNames, ...$viewNames] as $name) {
            $out['columns'][$name] = $processor->processColumns(
                self::asArrays($db->select($grammar->compileColumns($schema, $literal($name)))),
                $db->scalar($grammar->compileSqlCreateStatement($schema, $literal($name)))
            );
        }
        foreach ($tableNames as $name) {
            $out['indexes'][$name] = $processor->processIndexes(self::asArrays($db->select($grammar->compileIndexes($schema, $literal($name)))));
            $out['foreignKeys'][$name] = $processor->processForeignKeys(self::asArrays($db->select($grammar->compileForeignKeys($schema, $literal($name)))));
        }

        return $out;
    }
}
