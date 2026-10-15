<?php

namespace App\Database\Query;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
use App\Database\Sql\Classification;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Throwable;

final class QueryRunner
{
    public const MAX_BYTES = 20_000_000;

    public function __construct(
        private readonly ConnectionFactory $factory,
        private readonly DriverRegistry $drivers,
        private readonly DbErrorMapper $errors,
        private readonly HistoryRecorder $history,
    ) {}

    /**
     * Runs the items in order on one connection, stopping after the first error.
     *
     * @param  list<array{sql: string, classification: Classification}>  $items
     * @return list<StatementResult>
     */
    public function run(SavedConnection $connection, array $items, int $maxRows, bool $record = true): array
    {
        $driver = $this->drivers->for($connection->driver);
        $results = [];

        try {
            $this->factory->using($connection, function (Connection $db) use ($driver, $items, $maxRows, $connection, &$results) {
                $budget = self::MAX_BYTES;
                foreach ($items as $item) {
                    $started = hrtime(true);
                    try {
                        if ($connection->read_only) {
                            // Dynamic SQL (e.g. a function that runs set_config) can switch the session guard off
                            // without the classifier seeing it, so it is re-asserted before every statement.
                            $driver->enforceReadOnly($db);
                        }
                        $result = $driver->execute($db, $item['sql'], $item['classification'], $maxRows, max(0, $budget));
                    } catch (Throwable $e) {
                        $result = StatementResult::failed($item['sql'], $item['classification'], $this->errors->map($e), (int) round((hrtime(true) - $started) / 1_000_000));
                    }
                    $budget -= $result->bytes;
                    $results[] = $result;
                    if ($result->error) {
                        break;
                    }
                }
            }, (int) config('dbsuperb.query_timeout'));
        } catch (Throwable $e) {
            if ($results === []) {
                // The connection could not be opened: report it against the first statement.
                $results[] = StatementResult::failed($items[0]['sql'], $items[0]['classification'], $this->errors->map($e), 0);
            } else {
                // Statements already ran; keep their results and only log the late failure (e.g. on cleanup).
                report($e);
            }
        }

        if ($record) {
            $this->recordAll($connection, $results);
        }

        return $results;
    }

    /** @param list<StatementResult> $results */
    private function recordAll(SavedConnection $connection, array $results): void
    {
        foreach ($results as $result) {
            try {
                $this->history->record($connection, $result);
            } catch (Throwable $e) {
                report($e); // history is best effort and must never hide the results
            }
        }
    }
}
