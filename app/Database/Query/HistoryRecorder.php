<?php

namespace App\Database\Query;

use App\Database\Sql\SqlRedactor;
use App\Models\SavedConnection;
use Throwable;

final class HistoryRecorder
{
    public const MAX_SQL = 100_000;

    /**
     * Records each result in order. History is best effort: a failure is reported, never thrown, so it can't hide
     * results (or undo a commit) the user already has.
     *
     * @param  list<StatementResult>  $results
     */
    public function recordAll(SavedConnection $connection, array $results): void
    {
        foreach ($results as $result) {
            try {
                $this->record($connection, $result);
            } catch (Throwable $e) {
                report($e);
            }
        }
    }

    public function record(SavedConnection $connection, StatementResult $result): void
    {
        if (! $connection->store_history) {
            return;
        }

        [$sql, $error] = self::redact($result->sql, $result->error?->message, $connection->driver->value);

        $connection->history()->create([
            'sql' => mb_substr($sql, 0, self::MAX_SQL),
            'kind' => $result->classification->kind,
            'status' => $result->error ? 'error' : 'ok',
            'duration_ms' => $result->durationMs,
            'row_count' => $result->error || $result->columns === [] ? null : count($result->rows),
            'affected' => $result->affected,
            'error' => $error,
        ]);

        if (random_int(1, 50) === 1) {
            $this->prune($connection);
        }
    }

    /**
     * Credential literals are masked before anything is stored, and so is any echo of them in the DB's error text.
     *
     * @return array{string, ?string} the SQL and error text to store
     */
    public static function redact(string $sql, ?string $error, string $dialect): array
    {
        $scan = SqlRedactor::scan($sql, $dialect);
        // scan() lists each masked literal as written and decoded; scrub both from the error text.
        $error = $error === null ? null : str_replace($scan['secrets'], SqlRedactor::MASK, $error);

        return [$scan['sql'], $error];
    }

    public function prune(SavedConnection $connection): void
    {
        $keep = max(1, (int) config('dbsuperb.history_keep'));
        $stale = $connection->history()->orderByDesc('id')->skip($keep)->take(1000)->pluck('id');
        if ($stale->isNotEmpty()) {
            $connection->history()->whereIn('id', $stale)->delete();
        }
    }
}
