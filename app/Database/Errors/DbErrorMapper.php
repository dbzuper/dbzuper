<?php

namespace App\Database\Errors;

use App\Database\Exceptions\SqlitePathNotAllowed;
use Illuminate\Database\QueryException;
use InvalidArgumentException;
use PDOException;
use Throwable;

final class DbErrorMapper
{
    public function map(Throwable $e): DbError
    {
        if ($e instanceof SqlitePathNotAllowed) {
            return $e->reason === 'missing'
                ? new DbError('not_found', $e->getMessage(), null, 'sqlite_missing')
                : new DbError('permission', $e->getMessage(), null, 'sqlite_outside');
        }

        // Drivers throw this for unsafe option values; the message is ours and safe to show.
        if ($e instanceof InvalidArgumentException) {
            return new DbError('connection', $e->getMessage(), null, 'invalid_option');
        }

        $pdo = $e instanceof PDOException ? $e : ($e->getPrevious() instanceof PDOException ? $e->getPrevious() : null);
        if ($pdo === null && ! $e instanceof QueryException) {
            return new DbError('unknown', 'An unexpected error occurred.', null, null);
        }

        $raw = ($pdo ?? $e)->getMessage();
        $sqlstate = $pdo?->errorInfo[0] ?? (preg_match('/SQLSTATE\[(\w{5})\]/', $raw, $m) ? $m[1] : null);
        $driverCode = $pdo?->errorInfo[1] ?? (preg_match('/SQLSTATE\[\w{5}\]\s*\[(\d+)\]/', $raw, $m) ? (int) $m[1] : null);
        $message = $this->clean($raw);
        $lower = strtolower($raw);

        [$kind, $reason] = match (true) {
            str_contains($lower, 'getaddrinfo') || str_contains($lower, 'could not translate host name') || str_contains($lower, 'name or service not known') => ['connection', 'dns'],
            str_contains($lower, 'timed out') || str_contains($lower, 'timeout expired') || str_contains($lower, 'failed to respond') => ['timeout', 'timeout'],
            str_contains($lower, 'refused') => ['connection', 'refused'],
            $driverCode === 1045 || str_contains($lower, 'password authentication failed') || str_contains($lower, 'access denied for user') => ['auth', 'auth'],
            $driverCode === 1049 || (str_contains($lower, 'database "') && str_contains($lower, 'does not exist')) => ['not_found', 'unknown_database'],
            str_contains($lower, 'no pg_hba.conf entry') || str_contains($lower, 'ssl') || $driverCode === 3159 => ['connection', 'tls'],
            $sqlstate === '25006' || in_array($driverCode, [1792, 1290], true) || str_contains($lower, 'readonly database') => ['readonly', null],
            $sqlstate === '57014' || $driverCode === 3024 => ['timeout', null],
            $sqlstate === '42501' || in_array($driverCode, [1142, 1044, 1227], true) => ['permission', null],
            $sqlstate === '42601' || $driverCode === 1064 || str_contains($lower, 'syntax error') => ['syntax', null],
            str_starts_with((string) $sqlstate, '08') || $driverCode === 2002 || $driverCode === 2006 => ['connection', null],
            str_starts_with((string) $sqlstate, '42') => ['not_found', null],
            default => ['unknown', null],
        };

        return new DbError($kind, $message, $sqlstate, $reason);
    }

    private function clean(string $message): string
    {
        $message = preg_replace('/\s*\(Connection: .*$/s', '', $message) ?? $message;
        $message = preg_replace('/^SQLSTATE\[\w{5}\](:\s*[^:]+:)?\s*(\[\d+\]\s*)?(\d+\s+)?/', '', $message) ?? $message;

        return trim($message);
    }
}
