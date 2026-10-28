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
