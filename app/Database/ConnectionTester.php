<?php

namespace App\Database;

use App\Database\Errors\DbErrorMapper;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Throwable;

final class ConnectionTester
{
    public function __construct(
        private readonly ConnectionFactory $factory,
        private readonly DriverRegistry $drivers,
        private readonly DbErrorMapper $errors,
    ) {}

    /** @return array{ok: bool, version: ?string, latency_ms: int, error: ?array{kind: string, message: string, sqlstate: ?string, reason: ?string, position?: array{line: int, column: ?int}}} */
    public function test(SavedConnection $connection): array
    {
        $started = hrtime(true);
        if (! $connection->isServerLevel()) {
            return $this->attempt($connection, $started);
        }

        // A server-level connection is fine when any maintenance database accepts it; otherwise the first error,
        // usually the most telling (a wrong password fails them all alike), is reported.
        $first = null;
        foreach ($this->drivers->for($connection->driver)->maintenanceDatabases() as $database) {
            $result = $this->attempt($connection->forMaintenance($database), $started);
            if ($result['ok']) {
                return $result;
            }
            $first ??= $result;
        }

        return $first;
    }

    /** @return array{ok: bool, version: ?string, latency_ms: int, error: ?array{kind: string, message: string, sqlstate: ?string, reason: ?string, position?: array{line: int, column: ?int}}} */
    private function attempt(SavedConnection $connection, int $started): array
    {
        try {
            $version = $this->factory->using(
                $connection,
                function (Connection $db) use ($connection): string {
                    // Resolve the PDO first: connecting here avoids the query-level reconnect retry that would
                    // multiply the connect timeout on an unreachable host.
                    $db->getPdo();

                    return (string) $db->selectOne($this->drivers->for($connection->driver)->versionQuery())->version;
                },
            );

            return ['ok' => true, 'version' => $version, 'latency_ms' => $this->elapsed($started), 'error' => null];
        } catch (Throwable $e) {
            return ['ok' => false, 'version' => null, 'latency_ms' => $this->elapsed($started), 'error' => $this->errors->map($e)->toArray()];
        }
    }

    private function elapsed(int $started): int
    {
        return (int) round((hrtime(true) - $started) / 1_000_000);
    }
}
