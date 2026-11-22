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
