<?php

namespace App\Database\Drivers;

use App\Database\CellValue;
use App\Database\ColumnKind;
use App\Database\Contracts\Driver;
use App\Database\Contracts\SchemaInspector;
use App\Database\SqlitePathPolicy;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Database\Connection;
use Pdo\Sqlite;

class SqliteDriver implements Driver
{
    use ExecutesStatements;

    public function __construct(private readonly SqlitePathPolicy $paths) {}

    public function name(): DriverName
    {
        return DriverName::Sqlite;
    }

    public function config(SavedConnection $connection): array
    {
        return [
            'driver' => 'sqlite',
            'database' => $this->paths->resolve($connection->database),
            'prefix' => '',
            'foreign_key_constraints' => true,
            'options' => $connection->read_only ? [Sqlite::ATTR_OPEN_FLAGS => Sqlite::OPEN_READONLY] : [],
        ];
    }

    public function enforceReadOnly(Connection $db): void
    {
        // The file is opened OPEN_READONLY; nothing a statement does can change that.
    }

    public function explainPrefix(): string
    {
        return 'EXPLAIN QUERY PLAN ';
    }

    public function inspector(): SchemaInspector
    {
        return app(SqliteInspector::class);
    }

    public function versionQuery(): string
    {
        return 'select sqlite_version() as version';
    }

    public function applyStatementTimeout(Connection $db, int $seconds): void
    {
        // SQLite is in-process; there is no server-side statement timeout to set.
    }

    public function ddl(Connection $db, string $table, string $kind): ?string
    {
        return $db->selectOne("select sql from sqlite_master where name = ? and type in ('table', 'view')", [$table])?->sql;
    }

    public function quoteIdentifier(string $name): string
    {
        return '"'.str_replace('"', '""', $name).'"';
    }

    public function likeColumn(string $quotedColumn): string
    {
        return $quotedColumn;
    }

    public function sampleColumn(Connection $db, string $column, string $typeName, int $maxChars = CellValue::MAX_CHARS): Expression|string
    {
        $q = $this->quoteIdentifier($column);
        $sql = match (ColumnKind::classify($typeName)) {
            ColumnKind::Text => "substr({$q}, 1, ".($maxChars + 1).')',
            ColumnKind::Binary => "CASE WHEN {$q} IS NULL THEN NULL ELSE '[binary ' || length({$q}) || ' bytes]' END",
            default => $q,
        };

        return $db->raw("{$sql} AS {$q}");
    }
}
