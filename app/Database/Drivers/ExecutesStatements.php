<?php

namespace App\Database\Drivers;

use App\Database\CellValue;
use App\Database\Query\StatementResult;
use App\Database\Sql\Classification;
use Illuminate\Database\Connection;
use PDO;
use PDOStatement;

trait ExecutesStatements
{
    public function execute(Connection $db, string $sql, Classification $classification, int $maxRows, int $maxBytes): StatementResult
    {
        $started = hrtime(true);
        $pdo = $db->getPdo();
        $restore = $this->beforeStatement($pdo);

        try {
            $statement = $pdo->prepare($sql);
            $statement->execute();

            return $this->collect($statement, $sql, $classification, $maxRows, $maxBytes, $started);
        } finally {
            $this->afterStatement($pdo, $restore);
        }
    }

    protected function collect(PDOStatement $statement, string $sql, Classification $classification, int $maxRows, int $maxBytes, int $started): StatementResult
    {
        if ($statement->columnCount() === 0) {
            $affected = $statement->rowCount();
            $statement->closeCursor();

            return new StatementResult($sql, $classification, [], [], false, $affected, $this->elapsed($started));
        }

        $columns = $this->columnsOf($statement);
        $rows = [];
        $bytes = 0;
        $truncated = $this->appendRows($statement, $rows, $bytes, $maxRows, $maxBytes);
        $statement->closeCursor();

        return new StatementResult($sql, $classification, $columns, $rows, $truncated, null, $this->elapsed($started), null, $bytes);
    }

    /** @return list<array{name: string, type: ?string, table: ?string}> */
    protected function columnsOf(PDOStatement $statement): array
    {
        $columns = [];
        for ($i = 0; $i < $statement->columnCount(); $i++) {
            $meta = $statement->getColumnMeta($i) ?: [];
            $table = $meta['table'] ?? null;
            $columns[] = ['name' => (string) ($meta['name'] ?? "column{$i}"), 'type' => isset($meta['native_type']) ? strtolower((string) $meta['native_type']) : null, 'table' => is_string($table) && $table !== '' ? $table : null];
        }

        return $columns;
    }

    /**
     * Reads rows into $rows until the statement is exhausted or a cap is hit.
     *
     * @return bool true when a cap stopped the read (more rows exist or the byte budget ran out)
     */
    protected function appendRows(PDOStatement $statement, array &$rows, int &$bytes, int $maxRows, int $maxBytes): bool
    {
        while (($row = $statement->fetch(PDO::FETCH_NUM)) !== false) {
            if (count($rows) >= $maxRows) {
                return true;
            }
            $cells = array_map(fn ($v) => CellValue::present($v, CellValue::RESULT_CHARS), $row);
            $bytes += strlen((string) json_encode($cells, JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR));
            if ($bytes > $maxBytes) {
                return true;
            }
            $rows[] = $cells;
        }

        return false;
    }

    /** @return mixed state for afterStatement */
    protected function beforeStatement(PDO $pdo): mixed
    {
        return null;
    }

    protected function afterStatement(PDO $pdo, mixed $state): void {}

    protected function elapsed(int $started): int
    {
        return (int) round((hrtime(true) - $started) / 1_000_000);
    }
}
