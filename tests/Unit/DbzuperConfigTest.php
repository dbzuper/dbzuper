<?php

use Tests\TestCase;

uses(TestCase::class);

const DBZUPER_TIMEOUT_ENV = ['DBZUPER_INTROSPECTION_TIMEOUT', 'DBZUPER_QUERY_TIMEOUT', 'DBZUPER_SCHEMA_MAX_OBJECTS'];

function loadDbzuperConfigWith(string $value): array
{
    foreach (DBZUPER_TIMEOUT_ENV as $key) {
        $_ENV[$key] = $_SERVER[$key] = $value;
        putenv("{$key}={$value}");
    }

    try {
        return require config_path('dbzuper.php');
    } finally {
        foreach (DBZUPER_TIMEOUT_ENV as $key) {
            unset($_ENV[$key], $_SERVER[$key]);
            putenv($key);
        }
    }
}

it('falls back to defaults when the environment values are blank', function () {
    expect(loadDbzuperConfigWith(''))->toMatchArray([
        'introspection_timeout' => 30,
        'query_timeout' => 15,
        'schema_max_objects' => 5000,
    ]);
});

it('uses explicit environment values', function () {
    expect(loadDbzuperConfigWith('42'))->toMatchArray([
        'introspection_timeout' => 42,
        'query_timeout' => 42,
        'schema_max_objects' => 42,
    ]);
});

function loadDbzuperSqlitePaths(string $value): array
{
    $_ENV['DBZUPER_SQLITE_PATHS'] = $_SERVER['DBZUPER_SQLITE_PATHS'] = $value;
    putenv("DBZUPER_SQLITE_PATHS={$value}");

    try {
        return (require config_path('dbzuper.php'))['sqlite_paths'];
    } finally {
        unset($_ENV['DBZUPER_SQLITE_PATHS'], $_SERVER['DBZUPER_SQLITE_PATHS']);
        putenv('DBZUPER_SQLITE_PATHS');
    }
}

it('resolves relative SQLite directories against the app directory and keeps absolute ones', function () {
    expect(loadDbzuperSqlitePaths('storage/app/sqlite, /data/sqlite, C:\dbs ,, D:/more'))->toBe([
        base_path('storage/app/sqlite'),
        '/data/sqlite',
        'C:\dbs',
        'D:/more',
    ]);
});

it('allows no SQLite directory when the setting is blank', function () {
    expect(loadDbzuperSqlitePaths(''))->toBe([]);
});
