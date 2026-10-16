<?php

namespace App\Database\Query;

use App\Database\Sql\SqlRedactor;
use App\Models\SavedConnection;

final class HistoryRecorder
{
    public const MAX_SQL = 100_000;

    public function record(SavedConnection $connection, StatementResult $result): void
    {
        if (! $connection->store_history) {
            return;
        }

        // Credential literals are masked before anything is stored; so is any echo of them in the DB's error text.
        $redacted = SqlRedactor::scan($result->sql, $connection->driver->value);
        $error = $result->error?->message;
        foreach ($redacted['secrets'] as $secret) {
            $inner = trim($secret, "E'\"$");
            $error = $error === null ? null : str_replace(array_filter([$secret, strlen($inner) >= 4 ? $inner : null]), SqlRedactor::MASK, $error);
        }

        $connection->history()->create([
            'sql' => mb_substr($redacted['sql'], 0, self::MAX_SQL),
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

    public function prune(SavedConnection $connection): void
    {
        $keep = max(1, (int) config('dbsuperb.history_keep'));
        $stale = $connection->history()->orderByDesc('id')->skip($keep)->take(1000)->pluck('id');
        if ($stale->isNotEmpty()) {
            $connection->history()->whereIn('id', $stale)->delete();
        }
    }
}
