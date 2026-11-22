<?php

use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Transfers\Native\Compatibility;
use App\Transfers\Native\ToolLocator;

it('finds a configured override and ignores a missing one', function () {
    config(['dbzuper.transfer_tools.pg_dump' => __FILE__]);
    expect(ToolLocator::find('pg_dump'))->toBe(__FILE__);

    config(['dbzuper.transfer_tools.pg_dump' => '/nonexistent/pg_dump']);
    expect(ToolLocator::find('pg_dump'))->toBeNull();
});

it('reads a real pg_dump version', function () {
    config(['dbzuper.transfer_tools.pg_dump' => null]);
    $path = ToolLocator::find('pg_dump');
    if ($path === null) {
        $this->markTestSkipped('pg_dump not installed');
    }

    $output = ToolLocator::versionOutput($path);

    expect($output)->toContain('PostgreSQL');
    $check = Compatibility::evaluate(DriverName::Postgres, '1.0', TransferDirection::Export, 'pg_dump', $path, $output);
    expect($check->usable)->toBeTrue();
});

it('falls back to the newest laman version directory', function () {
    $root = sys_get_temp_dir().'/laman-'.uniqid();
    foreach (['16.2', '18.6', '9.9'] as $v) {
        mkdir("{$root}/bin/postgres/{$v}/bin", 0777, true);
    }
    touch("{$root}/bin/postgres/18.6/bin/pg_dump");
    touch("{$root}/bin/postgres/9.9/bin/pg_dump");
    touch("{$root}/bin/postgres/16.2/bin/psql");
    config(['dbzuper.transfer_tools.pg_dump' => null, 'dbzuper.transfer_tools.psql' => null]);
    putenv('PATH='.sys_get_temp_dir());

    try {
        expect(ToolLocator::find('pg_dump', $root))->toBe("{$root}/bin/postgres/18.6/bin/pg_dump")
            ->and(ToolLocator::find('psql', $root))->toBe("{$root}/bin/postgres/16.2/bin/psql")
            ->and(ToolLocator::find('mariadb-dump', $root))->toBeNull();
    } finally {
        putenv('PATH='.$_SERVER['PATH']);
    }
});

it('reads real laman tool versions when present', function () {
    $home = getenv('USERPROFILE') ?: getenv('HOME');
    $root = $home.'/.laman';
    config(['dbzuper.transfer_tools.pg_dump' => null, 'dbzuper.transfer_tools.mariadb-dump' => null]);
    $found = array_filter([ToolLocator::find('pg_dump', $root), ToolLocator::find('mariadb-dump', $root)]);
    if ($found === []) {
        $this->markTestSkipped('no laman tools installed');
    }

    foreach ($found as $path) {
        expect(ToolLocator::versionOutput($path))->toMatch('/\d+\.\d+/');
    }
});

function fakeTool(string $dir, string $name, string $output): string
{
    @mkdir($dir, 0777, true);
    if (PHP_OS_FAMILY === 'Windows') {
        $path = "{$dir}/{$name}.bat";
        file_put_contents($path, "@echo off\r\necho {$output}\r\n");
    } else {
        $path = "{$dir}/{$name}";
        file_put_contents($path, "#!/bin/sh\necho '{$output}'\n");
        chmod($path, 0755);
    }

    return $path;
}

it('prefers a compatible laman tool over a stale PATH one', function () {
    $base = sys_get_temp_dir().'/compat-'.uniqid();
    fakeTool("{$base}/path", 'pg_dump', 'pg_dump (PostgreSQL) 14.1');
    $laman = fakeTool("{$base}/laman/bin/postgres/18.6/bin", 'pg_dump', 'pg_dump (PostgreSQL) 18.6');
    config(['dbzuper.transfer_tools.pg_dump' => null]);
    $oldPath = getenv('PATH');
    putenv('PATH='.$base.'/path');

    try {
        $check = Compatibility::check(DriverName::Postgres, '18.0', TransferDirection::Export, "{$base}/laman");
        expect($check->usable)->toBeTrue()->and($check->path)->toBe($laman)->and($check->reason)->toBe('pg_dump 18.6');

        $none = Compatibility::check(DriverName::Postgres, '18.0', TransferDirection::Export, "{$base}/nolaman");
        expect($none->usable)->toBeFalse()->and($none->reason)->toBe('pg_dump 14 found, server is 18 — using built-in');
    } finally {
        putenv('PATH='.$oldPath);
    }
});

it('prefers a MySQL-flavoured tool under laman over a MariaDB one on PATH', function () {
    $base = sys_get_temp_dir().'/compat-'.uniqid();
    fakeTool("{$base}/path", 'mysqldump', 'mysqldump from 11.4.2-MariaDB, client 10.19 for Win64 (AMD64)');
    $laman = fakeTool("{$base}/laman/bin/mysql/8.4.0/bin", 'mysqldump', 'mysqldump  Ver 8.4.0 for Win64 on x86_64 (MySQL Community Server - GPL)');
    config(['dbzuper.transfer_tools.mysqldump' => null]);
    $oldPath = getenv('PATH');
    putenv('PATH='.$base.'/path');

    try {
        $check = Compatibility::check(DriverName::MySql, '8.4.2', TransferDirection::Export, "{$base}/laman");
        expect($check->usable)->toBeTrue()->and($check->path)->toBe($laman);
    } finally {
        putenv('PATH='.$oldPath);
    }
});

it('caches a failed version call briefly', function () {
    $path = fakeTool(sys_get_temp_dir().'/compat-'.uniqid(), 'broken', 'x');
    file_put_contents($path, PHP_OS_FAMILY === 'Windows' ? "@exit /b 1\r\n" : "#!/bin/sh\nexit 1\n");

    expect(ToolLocator::versionOutput($path))->toBeNull();
    expect(Cache::get('dbzuper.tool-version.'.sha1($path.'|'.filemtime($path))))->toBe('');
});
