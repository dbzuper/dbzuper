<?php

use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Transfers\Native\Compatibility;

$mysqlTool = 'mysqldump  Ver 8.4.3 for Linux on x86_64 (MySQL Community Server - GPL)';
$mariaOnMysqlName = 'mysqldump from 11.4.2-MariaDB, client 10.19 for debian-linux-gnu (x86_64)';
$mariaDump = 'mariadb-dump from 11.4.2-MariaDB, client 10.19 for debian-linux-gnu (x86_64)';

it('evaluates tools against servers', function (DriverName $driver, string $server, TransferDirection $dir, string $tool, ?string $output, bool $usable, string $reason) {
    $check = Compatibility::evaluate($driver, $server, $dir, $tool, $output === null ? null : '/usr/bin/'.$tool, $output);

    expect($check->usable)->toBe($usable)->and($check->reason)->toBe($reason);
})->with([
    'pg newer tool' => [DriverName::Postgres, '18.0 (Debian 18.0-1.pgdg120+1)', TransferDirection::Export, 'pg_dump', 'pg_dump (PostgreSQL) 18.1', true, 'pg_dump 18.1'],
    'pg older tool' => [DriverName::Postgres, 'PostgreSQL 18.0 on x86_64-pc-linux-gnu', TransferDirection::Export, 'pg_dump', 'pg_dump (PostgreSQL) 16.4', false, 'pg_dump 16 found, server is 18 — using built-in'],
    'psql newer' => [DriverName::Postgres, '16.2', TransferDirection::Import, 'psql', 'psql (PostgreSQL) 17.0', true, 'psql 17.0'],
    'mysql ok' => [DriverName::MySql, '8.4.2', TransferDirection::Export, 'mysqldump', $mysqlTool, true, 'mysqldump 8.4.3'],
    'mysql tool too old' => [DriverName::MySql, '8.4.2', TransferDirection::Export, 'mysqldump', 'mysqldump  Ver 5.7.44 for Linux on x86_64 (MySQL Community Server (GPL))', false, 'mysqldump 5 found, server is 8 — using built-in'],
    'mariadb tool on mysql' => [DriverName::MySql, '8.4.2', TransferDirection::Export, 'mysqldump', $mariaOnMysqlName, false, "mysqldump from MariaDB can't dump MySQL 8+ reliably — using built-in"],
    'mariadb ok' => [DriverName::MariaDb, '11.4.2-MariaDB', TransferDirection::Export, 'mariadb-dump', $mariaDump, true, 'mariadb-dump 11.4.2'],
    'mariadb suffix' => [DriverName::MariaDb, '11.4.2-MariaDB-ubu2404', TransferDirection::Export, 'mysqldump', $mariaOnMysqlName, true, 'mysqldump 11.4.2'],
    'mysql tool on mariadb' => [DriverName::MariaDb, '11.4.2-MariaDB', TransferDirection::Export, 'mysqldump', $mysqlTool, false, "mysqldump from MySQL can't dump MariaDB reliably — using built-in"],
    'mariadb windows' => [DriverName::MariaDb, '12.3.3-MariaDB', TransferDirection::Export, 'mariadb-dump', 'C:/Users/x/.laman/bin/mariadb/12.3.3/bin/mariadb-dump.exe from 12.3.3-MariaDB, client 10.20 for Win64 (AMD64)', true, 'mariadb-dump 12.3.3'],
    'missing' => [DriverName::Postgres, '18.0', TransferDirection::Export, 'pg_dump', null, false, 'pg_dump not found — using built-in'],
    'no version' => [DriverName::Postgres, '18.0', TransferDirection::Export, 'pg_dump', '', false, 'pg_dump found but did not report a version — using built-in'],
    'garbage version' => [DriverName::Postgres, '18.0', TransferDirection::Export, 'pg_dump', 'hello', false, 'pg_dump found but did not report a version — using built-in'],
]);

it('never uses a native tool for sqlite', function () {
    $check = Compatibility::evaluate(DriverName::Sqlite, '3.45.0', TransferDirection::Export, 'sqlite3', '/x', 'sqlite3 3.45');

    expect($check->usable)->toBeFalse()
        ->and($check->reason)->toBe('SQLite always uses the built-in method');
    expect(Compatibility::check(DriverName::Sqlite, '3.45.0', TransferDirection::Import)->usable)->toBeFalse();
});

it('reports the tool and path when usable', function () {
    $check = Compatibility::evaluate(DriverName::Postgres, '18.0', TransferDirection::Export, 'pg_dump', '/usr/bin/pg_dump', 'pg_dump (PostgreSQL) 18.1');

    expect($check->tool)->toBe('pg_dump')->and($check->path)->toBe('/usr/bin/pg_dump')->and($check->version)->toBe('18.1');
});
