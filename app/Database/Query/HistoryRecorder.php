<?php

namespace App\Database\Query;

use App\Database\Sql\SqlRedactor;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Models\SavedConnection;
use App\Models\Transfer;
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
     * One summary entry per finished backup or restore (spec §4), as a one-line SQL comment:
     * "-- Backup: 214 tables, 1.8 GB, native" / "-- Restore: shop_prod-20261122.sql.gz, 12,340 statements, built-in".
     */
    public function recordTransfer(SavedConnection $connection, Transfer $transfer): void
    {
        if (! $connection->store_history) {
            return;
        }

        $method = $transfer->method === TransferMethod::Native ? 'native' : 'built-in';
        if ($transfer->direction === TransferDirection::Export) {
            $tables = $transfer->options['table_count'] ?? null;
            $parts = [
                is_int($tables) ? number_format($tables).' '.($tables === 1 ? 'table' : 'tables') : null,
                $transfer->file_size !== null ? self::bytesForHumans($transfer->file_size) : null,
                $method,
            ];
            $line = '-- Backup: ';
        } else {
            $statements = (int) $transfer->statements_done;
            $parts = [
                str_replace(["\r", "\n"], ' ', (string) $transfer->file_name),
                number_format($statements).' '.($statements === 1 ? 'statement' : 'statements'),
                $method,
            ];
            $line = '-- Restore: ';
        }
        $line .= implode(', ', array_filter($parts, fn (?string $p) => $p !== null && $p !== ''));

        $ms = $transfer->started_at !== null && $transfer->finished_at !== null
            ? (int) max(0, $transfer->started_at->diffInMilliseconds($transfer->finished_at))
            : 0;
        $failed = $transfer->status !== TransferStatus::Done;

        $connection->history()->create([
            'sql' => mb_substr($line, 0, self::MAX_SQL),
            'kind' => 'transfer',
            'status' => $failed ? 'error' : 'ok',
            'duration_ms' => min($ms, 4_294_967_295),
            'row_count' => null,
            'affected' => null,
            'error' => $failed ? $transfer->error : null,
        ]);
    }

    /** "512 B", "1.8 GB": binary multiples, one decimal from KB up. */
    public static function bytesForHumans(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        $size = (float) max(0, $bytes);
        $unit = 0;
        while ($size >= 1024 && $unit < count($units) - 1) {
            $size /= 1024;
            $unit++;
        }

        return $unit === 0 ? ((int) $size).' B' : rtrim(rtrim(number_format($size, 1, '.', ''), '0'), '.').' '.$units[$unit];
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
        $keep = max(1, (int) config('dbzuper.history_keep'));
        $stale = $connection->history()->orderByDesc('id')->skip($keep)->take(1000)->pluck('id');
        if ($stale->isNotEmpty()) {
            $connection->history()->whereIn('id', $stale)->delete();
        }
    }
}
