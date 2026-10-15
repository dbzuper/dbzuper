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
            $this->factory->using($connection, function (Connection $db) use ($driver, $items, $maxRows, $connection, $record, &$results) {
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
                    if ($record) {
                        $this->history->record($connection, $result);
                    }
                    if ($result->error) {
                        break;
                    }
                }
            }, (int) config('dbsuperb.query_timeout'));
        } catch (Throwable $e) {
            // The connection could not be opened (or broke outside a statement).
            $item = $items[count($results)] ?? $items[0];
            $failed = StatementResult::failed($item['sql'], $item['classification'], $this->errors->map($e), 0);
            $results[] = $failed;
            if ($record) {
                $this->history->record($connection, $failed);
            }
        }

        return $results;
    }
}
