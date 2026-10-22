<?php

namespace App\Database\Editing;

use App\Database\Errors\DbErrorMapper;
use App\Database\Query\HistoryRecorder;
use App\Database\Query\StatementResult;
use App\Database\Sql\StatementClassifier;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use LogicException;
use Throwable;

/**
 * Commits a built change set (spec §5, §7): every statement in one transaction, each affecting exactly one row, or
 * nothing at all. The connection must have been opened with countMatchedRows, so an UPDATE to the same value still
 * counts as its one row on MySQL/MariaDB.
 */
final class ChangeSetRunner
{
    public function __construct(
        private readonly DbErrorMapper $errors,
        private readonly HistoryRecorder $history,
    ) {}

    /**
     * Runs the statements in order. Any row count other than 1 or any database error rolls the whole transaction
     * back. Only after the commit are the statements recorded in history, as previewed.
     *
     * @param  list<BuiltStatement>  $statements  in execution order
     * @return array{inserted: int, updated: int, deleted: int}
     *
     * @throws RowMismatch
     * @throws ChangeFailed
     */
    public function commit(SavedConnection $connection, Connection $db, array $statements): array
    {
        if ($connection->read_only) {
            // The endpoint refuses read-only connections before connecting; this is only a backstop.
            throw new LogicException('A change set never runs on a read-only connection.');
        }

        $dialect = $connection->driver->value;
        $results = [];
        $running = null;

        try {
            $db->beginTransaction();
            foreach ($statements as $statement) {
                $running = $statement->index;
                $started = hrtime(true);
                $affected = $db->affectingStatement($statement->sql, $statement->bindings);
                if ($affected !== 1) {
                    throw RowMismatch::forCount($statement->index, $affected);
                }
                $results[] = new StatementResult(
                    $statement->previewSql, StatementClassifier::classify($statement->previewSql, $dialect), [], [], false, $affected,
                    (int) round((hrtime(true) - $started) / 1_000_000),
                );
            }
            $running = null;
            $db->commit();
        } catch (RowMismatch $e) {
            $this->rollBack($db);

            throw $e;
        } catch (Throwable $e) {
            $this->rollBack($db);

            throw new ChangeFailed($running, $this->errors->map($e));
        }

        $this->history->recordAll($connection, $results);

        $counts = array_count_values(array_map(fn (BuiltStatement $s) => $s->op, $statements));

        return ['inserted' => $counts['insert'] ?? 0, 'updated' => $counts['update'] ?? 0, 'deleted' => $counts['delete'] ?? 0];
    }

    private function rollBack(Connection $db): void
    {
        try {
            $db->rollBack();
        } catch (Throwable $e) {
            // The connection is released right after, which ends the transaction anyway.
            report($e);
        }
    }
}
