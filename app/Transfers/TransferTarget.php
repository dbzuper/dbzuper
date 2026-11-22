<?php

namespace App\Transfers;

use App\Enums\DriverName;
use App\Models\SavedConnection;

/**
 * Which database a transfer was started against. Stored with the transfer when it starts and compared when the job
 * runs, so a saved connection edited in between (another host, database or file, or turned server-level) fails the
 * job instead of backing up or restoring a database the user never confirmed.
 */
final class TransferTarget
{
    /** @return array{driver: string, host: ?string, port: ?int, database: string} */
    public static function fingerprint(SavedConnection $connection): array
    {
        $database = (string) $connection->database;
        if ($connection->driver === DriverName::Sqlite) {
            $database = realpath($database) ?: $database;
        }

        return [
            'driver' => $connection->driver->value,
            'host' => $connection->host === null ? null : (string) $connection->host,
            'port' => $connection->port === null ? null : (int) $connection->port,
            'database' => $database,
        ];
    }

    /** @param  array<mixed>|null  $stored */
    public static function matches(SavedConnection $connection, ?array $stored): bool
    {
        // Transfers started before fingerprints existed have none to compare.
        return $stored === null || self::fingerprint($connection) === $stored;
    }
}
