<?php

namespace App\Database\Errors;

use App\Database\Exceptions\InvalidConnectionOption;
use App\Database\Exceptions\OffsetQueryException;
use App\Database\Exceptions\SqlitePathNotAllowed;
use Illuminate\Database\QueryException;
use PDOException;
use Throwable;

final class DbErrorMapper
{
    /** @param int $columnOffset characters prepended to the user's SQL, subtracted from line-1 positions */
    public function map(Throwable $e, int $columnOffset = 0): DbError
    {
        if ($e instanceof OffsetQueryException) {
            return $this->map($e->original, $e->columnOffset);
        }

        if ($e instanceof SqlitePathNotAllowed) {
            return $e->reason === 'missing'
                ? new DbError('not_found', $e->getMessage(), null, 'sqlite_missing')
                : new DbError('permission', $e->getMessage(), null, 'sqlite_outside');
        }

        // Drivers throw this for unsafe option values; the message is ours and safe to show.
        if ($e instanceof InvalidConnectionOption) {
            return new DbError('connection', $e->getMessage(), null, 'invalid_option');
        }

        $pdo = $e instanceof PDOException ? $e : ($e->getPrevious() instanceof PDOException ? $e->getPrevious() : null);
        if ($pdo === null && ! $e instanceof QueryException) {
            // Not a database error, so most likely a bug: the user sees a generic message, the log gets the details.
            report($e);

            return new DbError('unknown', 'An unexpected error occurred.', null, null);
        }

        $raw = ($pdo ?? $e)->getMessage();
        $sqlstate = $pdo?->errorInfo[0] ?? (preg_match('/SQLSTATE\[(\w{5})\]/', $raw, $m) ? $m[1] : null);
        $driverCode = $pdo?->errorInfo[1] ?? (preg_match('/SQLSTATE\[\w{5}\]\s*\[(\d+)\]/', $raw, $m) ? (int) $m[1] : null);
        $message = $this->clean($raw);
        $position = $this->position($raw, $columnOffset);
        // Match on the cleaned message only: the raw QueryException suffix embeds user SQL text.
        $lower = strtolower($message);
        $connectionClass = str_starts_with((string) $sqlstate, '08')
            || in_array($driverCode, [2002, 2003, 2005, 2006, 2026, 3159], true)
            || ($pdo !== null && $pdo->errorInfo === null);

        [$kind, $reason] = match (true) {
            $connectionClass && (str_contains($lower, 'getaddrinfo') || str_contains($lower, 'could not translate host name') || str_contains($lower, 'name or service not known')) => ['connection', 'dns'],
            $connectionClass && (str_contains($lower, 'timed out') || str_contains($lower, 'timeout expired') || str_contains($lower, 'failed to respond')) => ['timeout', 'timeout'],
            $connectionClass && str_contains($lower, 'refused') => ['connection', 'refused'],
            $driverCode === 1045 || str_contains($lower, 'password authentication failed') || str_contains($lower, 'access denied for user') => ['auth', 'auth'],
            $driverCode === 1049 || (str_contains($lower, 'database "') && str_contains($lower, 'does not exist')) => ['not_found', 'unknown_database'],
            $connectionClass && (str_contains($lower, 'no pg_hba.conf entry') || $driverCode === 3159 || $this->mentionsTls($lower)) => ['connection', 'tls'],
            $sqlstate === '25006' || in_array($driverCode, [1792, 1290], true) || str_contains($lower, 'readonly database') => ['readonly', null],
            $sqlstate === '57014' || $driverCode === 3024 => ['timeout', null],
            $sqlstate === '42501' || in_array($driverCode, [1142, 1044, 1227], true) => ['permission', null],
            $sqlstate === '42601' || $driverCode === 1064 || str_contains($lower, 'syntax error') => ['syntax', null],
            str_starts_with((string) $sqlstate, '08') || $driverCode === 2002 || $driverCode === 2006 => ['connection', null],
            str_starts_with((string) $sqlstate, '42') => ['not_found', null],
            default => ['unknown', null],
        };

        return new DbError($kind, $message, $sqlstate, $reason, $position);
    }

    private function mentionsTls(string $lower): bool
    {
        foreach (['ssl connection', 'sslmode', 'ssl error', 'server does not support ssl', 'ssl is required', 'ssl negotiation', 'tls'] as $phrase) {
            if (str_contains($lower, $phrase)) {
                return true;
            }
        }

        return false;
    }

    private function clean(string $message): string
    {
        $message = preg_replace('/\s*\(Connection: .*$/s', '', $message) ?? $message;
        $message = preg_replace('/^SQLSTATE\[\w{5}\](:\s*[^:]+:)?\s*(\[\d+\]\s*)?(\d+\s+)?/', '', $message) ?? $message;

        // PostgreSQL appends LINE/caret context on further lines; the position is reported separately.
        return trim((string) strtok(trim($message), "\n"));
    }

    /** @return array{line: int, column: ?int}|null */
    private function position(string $raw, int $columnOffset): ?array
    {
        if (preg_match('/LINE (\d+): (.*)\n(\s*)\^/', $raw, $m)) {
            $prefix = strlen('LINE '.$m[1].': ');
            $column = strlen($m[3]) - $prefix + 1;
            $line = (int) $m[1];
            if ($line === 1) {
                $column -= $columnOffset;
            }

            return ['line' => $line, 'column' => max(1, $column)];
        }
        if (preg_match('/ at line (\d+)\s*$/', $raw, $m)) {
            return ['line' => (int) $m[1], 'column' => null];
        }

        return null;
    }
}
