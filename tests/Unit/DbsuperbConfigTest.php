<?php

use Tests\TestCase;

uses(TestCase::class);

const DBSUPERB_TIMEOUT_ENV = ['DBSUPERB_INTROSPECTION_TIMEOUT', 'DBSUPERB_QUERY_TIMEOUT', 'DBSUPERB_SCHEMA_MAX_OBJECTS'];

function loadDbsuperbConfigWith(string $value): array
{
    foreach (DBSUPERB_TIMEOUT_ENV as $key) {
        $_ENV[$key] = $_SERVER[$key] = $value;
        putenv("{$key}={$value}");
    }

    try {
        return require config_path('dbsuperb.php');
    } finally {
        foreach (DBSUPERB_TIMEOUT_ENV as $key) {
            unset($_ENV[$key], $_SERVER[$key]);
            putenv($key);
        }
    }
}

it('falls back to defaults when the environment values are blank', function () {
    expect(loadDbsuperbConfigWith(''))->toMatchArray([
        'introspection_timeout' => 30,
        'query_timeout' => 15,
        'schema_max_objects' => 5000,
    ]);
});

it('uses explicit environment values', function () {
    expect(loadDbsuperbConfigWith('42'))->toMatchArray([
        'introspection_timeout' => 42,
        'query_timeout' => 42,
        'schema_max_objects' => 42,
    ]);
});
