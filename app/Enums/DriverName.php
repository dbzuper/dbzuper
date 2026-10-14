<?php

namespace App\Enums;

enum DriverName: string
{
    case MySql = 'mysql';
    case MariaDb = 'mariadb';
    case Postgres = 'pgsql';
    case Sqlite = 'sqlite';

    public function label(): string
    {
        return match ($this) {
            self::MySql => 'MySQL',
            self::MariaDb => 'MariaDB',
            self::Postgres => 'PostgreSQL',
            self::Sqlite => 'SQLite',
        };
    }

    public function defaultPort(): ?int
    {
        return match ($this) {
            self::MySql, self::MariaDb => 3306,
            self::Postgres => 5432,
            self::Sqlite => null,
        };
    }

    public function isServer(): bool
    {
        return $this !== self::Sqlite;
    }
}
