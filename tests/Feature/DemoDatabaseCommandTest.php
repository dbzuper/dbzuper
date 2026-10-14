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
