<?php

it('writes a commerce demo SQLite database', function () {
    $path = storage_path('framework/testing/sqlite/demo-'.bin2hex(random_bytes(3)).'.sqlite');

    $this->artisan('dbsuperb:demo-database', ['path' => $path])->assertSuccessful();

    $pdo = new PDO('sqlite:'.$path);
    expect((int) $pdo->query('select count(*) from users')->fetchColumn())->toBe(3)
        ->and((int) $pdo->query('select count(*) from order_totals')->fetchColumn())->toBeGreaterThan(0);
    unset($pdo);
    @unlink($path);
});

it('refuses to overwrite an existing file without --force', function () {
    $path = storage_path('framework/testing/sqlite/demo-'.bin2hex(random_bytes(3)).'.sqlite');
    @mkdir(dirname($path), 0777, true);
    file_put_contents($path, 'precious data');

    $this->artisan('dbsuperb:demo-database', ['path' => $path])->assertFailed();

    expect(file_get_contents($path))->toBe('precious data');
    @unlink($path);
});

it('overwrites an existing file with --force', function () {
    $path = storage_path('framework/testing/sqlite/demo-'.bin2hex(random_bytes(3)).'.sqlite');
    @mkdir(dirname($path), 0777, true);
    file_put_contents($path, 'precious data');

    $this->artisan('dbsuperb:demo-database', ['path' => $path, '--force' => true])->assertSuccessful();

    $pdo = new PDO('sqlite:'.$path);
    expect((int) $pdo->query('select count(*) from users')->fetchColumn())->toBe(3);
    unset($pdo);
    @unlink($path);
});

it('adds synthetic tables with foreign keys', function () {
    $path = storage_path('framework/testing/sqlite/synthetic-'.bin2hex(random_bytes(3)).'.sqlite');

    $this->artisan('dbsuperb:demo-database', ['path' => $path, '--tables' => 30])->assertSuccessful();

    $pdo = new PDO('sqlite:'.$path);
    $tables = (int) $pdo->query("select count(*) from sqlite_master where type = 'table' and name like 'm%_t%'")->fetchColumn();
    $fks = (int) $pdo->query("select count(*) from pragma_foreign_key_list('m000_t02')")->fetchColumn();
    expect($tables)->toBe(30)->and($fks)->toBe(2);
    unset($pdo);
    @unlink($path);
});

it('rejects an out-of-range table count', function () {
    $this->artisan('dbsuperb:demo-database', ['path' => storage_path('framework/testing/sqlite/x.sqlite'), '--tables' => 20001])->assertFailed();
});

it('rejects a non-numeric table count', function () {
    $path = storage_path('framework/testing/sqlite/abc-'.bin2hex(random_bytes(3)).'.sqlite');

    $this->artisan('dbsuperb:demo-database', ['path' => $path, '--tables' => 'abc'])->assertFailed();

    expect(file_exists($path))->toBeFalse();
});
