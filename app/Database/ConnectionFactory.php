<?php

namespace App\Database;

use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Illuminate\Database\DatabaseManager;

final class ConnectionFactory
{
    public function __construct(
        private readonly DatabaseManager $manager,
        private readonly DriverRegistry $drivers,
    ) {}

    public function make(SavedConnection $connection): Connection
    {
        $name = 'dbsuperb_'.($connection->getKey() ?? 'transient').'_'.bin2hex(random_bytes(3));
        $config = $this->drivers->for($connection->driver)->config($connection);

        // Registered in config so Laravel can rebuild the connection by name on reconnect. This matters on
        // PostgreSQL: a read-only violation (SQLSTATE 25006) is treated as a lost connection, which triggers
        // reconnect() and a retry; the guard is re-applied then and the QueryException still surfaces.
        config(["database.connections.{$name}" => $config]);

        return $this->manager->connectUsing($name, $config, force: true);
    }

    public function release(Connection $db): void
    {
        $name = $db->getName();

        $this->manager->purge($name);
        config(["database.connections.{$name}" => null]);
    }
}
