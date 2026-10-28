<?php

namespace App\Database;

use App\Models\SavedConnection;
use Closure;
use Illuminate\Database\Connection;
use Illuminate\Database\DatabaseManager;
use Throwable;

final class ConnectionFactory
{
    public function __construct(
        private readonly DatabaseManager $manager,
        private readonly DriverRegistry $drivers,
    ) {}

    /** Runs the callback with a connection and always releases it, even when the callback throws.
     * A timeout is applied now and again after every reconnect. $countMatchedRows: see Driver::config(). */
    public function using(SavedConnection $connection, Closure $callback, ?int $timeoutSeconds = null, bool $countMatchedRows = false): mixed
    {
        $db = $this->make($connection, $countMatchedRows);

        try {
            if ($timeoutSeconds !== null) {
                $driver = $this->drivers->for($connection->driver);
                $driver->applyStatementTimeout($db, $timeoutSeconds);
                // Laravel reconnects transparently on some errors; session settings must follow.
                $db->setReconnector(function (Connection $reconnecting) use ($driver, $timeoutSeconds) {
                    $this->manager->reconnect($reconnecting->getName());
                    $driver->applyStatementTimeout($reconnecting, $timeoutSeconds);
                });
            }

            return $callback($db);
        } finally {
            $this->release($db);
        }
    }

    public function make(SavedConnection $connection, bool $countMatchedRows = false): Connection
    {
        $name = 'dbzuper_'.($connection->getKey() ?? 'transient').'_'.bin2hex(random_bytes(8));
        $config = $this->drivers->for($connection->driver)->config($connection, $countMatchedRows);

        // Registered in config so Laravel can rebuild the connection by name on reconnect. This matters on
        // PostgreSQL: a read-only violation (SQLSTATE 25006) is treated as a lost connection, which triggers
        // reconnect() and a retry; the guard is re-applied then and the QueryException still surfaces.
        config(["database.connections.{$name}" => $config]);

        try {
            return $this->manager->connectUsing($name, $config, force: true);
        } catch (Throwable $e) {
            $this->forget($name);

            throw $e;
        }
    }

    public function release(Connection $db): void
    {
        $name = $db->getName();

        $this->manager->purge($name);
        $this->forget($name);
    }

    private function forget(string $name): void
    {
        $all = config('database.connections', []);
        unset($all[$name]);
        config(['database.connections' => $all]);
    }
}
