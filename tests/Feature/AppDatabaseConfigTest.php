<?php

use Illuminate\Support\Facades\DB;

// The app database is SQLite, served by a multi-threaded FrankenPHP in the Docker image: concurrent
// requests must wait for the lock (busy_timeout) rather than fail with "database is locked".

function sqliteConfigWithEnv(array $env): array
{
    $saved = [];
    foreach ($env as $key => $value) {
        $saved[$key] = $_SERVER[$key] ?? null;
        $_SERVER[$key] = $value;
    }

    try {
        return (require config_path('database.php'))['connections']['sqlite'];
    } finally {
        foreach ($saved as $key => $value) {
            if ($value === null) {
                unset($_SERVER[$key]);
            } else {
                $_SERVER[$key] = $value;
            }
        }
    }
}

test('the sqlite connection waits for locks by default and keeps deferred transactions', function () {
    $config = sqliteConfigWithEnv([]);

    expect((int) $config['busy_timeout'])->toBe(5000)
        ->and($config['transaction_mode'])->toBe('DEFERRED')
        ->and($config['journal_mode'])->toBeNull();

    expect((int) DB::connection('sqlite')->selectOne('pragma busy_timeout')->timeout)->toBe(5000);
});

test('the sqlite lock settings follow the environment', function () {
    $config = sqliteConfigWithEnv([
        'DB_BUSY_TIMEOUT' => '7000',
        'DB_JOURNAL_MODE' => 'WAL',
        'DB_TRANSACTION_MODE' => 'IMMEDIATE',
    ]);

    expect((int) $config['busy_timeout'])->toBe(7000)
        ->and($config['journal_mode'])->toBe('WAL')
        ->and($config['transaction_mode'])->toBe('IMMEDIATE');
});
