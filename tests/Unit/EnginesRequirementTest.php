<?php

use PHPUnit\Framework\AssertionFailedError;
use PHPUnit\Framework\SkippedTest;
use PHPUnit\Framework\SkippedWithMessageException;
use Tests\Support\Engines;
use Tests\TestCase;

uses(TestCase::class);

function withEnv(array $vars, Closure $callback): void
{
    $saved = [];
    foreach ($vars as $key => $value) {
        $saved[$key] = [$_SERVER[$key] ?? null, $_ENV[$key] ?? null, getenv($key)];
        $_SERVER[$key] = $_ENV[$key] = $value;
        putenv("{$key}={$value}");
    }

    try {
        $callback();
    } finally {
        foreach ($saved as $key => [$server, $env, $put]) {
            if ($server === null) {
                unset($_SERVER[$key]);
            } else {
                $_SERVER[$key] = $server;
            }
            if ($env === null) {
                unset($_ENV[$key]);
            } else {
                $_ENV[$key] = $env;
            }
            putenv($put === false ? $key : "{$key}={$put}");
        }
    }
}

it('fails instead of skipping an unreachable engine when engines are required', function () {
    withEnv(['DBZUPER_REQUIRE_ENGINES' => '1', 'TEST_MYSQL_PORT' => '1'], function () {
        try {
            Engines::skipUnlessAvailable('mysql');
            $thrown = null;
        } catch (AssertionFailedError $e) {
            $thrown = $e;
        }

        expect($thrown)->toBeInstanceOf(AssertionFailedError::class)
            ->and($thrown)->not->toBeInstanceOf(SkippedTest::class)
            ->and($thrown->getMessage())->toContain('mysql test server not reachable');
    });
});

it('skips an unreachable engine when engines are not required', function () {
    withEnv(['DBZUPER_REQUIRE_ENGINES' => '0', 'TEST_MYSQL_PORT' => '1'], function () {
        expect(fn () => Engines::skipUnlessAvailable('mysql'))->toThrow(SkippedWithMessageException::class);
    });
});

it('fails instead of skipping a missing native tool when tools are required', function () {
    config(['dbzuper.transfer_tools.pg_dump' => base_path('missing/pg_dump')]);

    withEnv(['DBZUPER_REQUIRE_NATIVE_TOOLS' => '1'], function () {
        try {
            Engines::skipUnlessTool('pg_dump');
            $thrown = null;
        } catch (AssertionFailedError $e) {
            $thrown = $e;
        }

        expect($thrown)->toBeInstanceOf(AssertionFailedError::class)
            ->and($thrown)->not->toBeInstanceOf(SkippedTest::class)
            ->and($thrown->getMessage())->toBe('pg_dump not found (DBZUPER_REQUIRE_NATIVE_TOOLS=1)');
    });
});

it('skips a missing native tool when tools are not required', function () {
    config(['dbzuper.transfer_tools.pg_dump' => base_path('missing/pg_dump')]);

    withEnv(['DBZUPER_REQUIRE_NATIVE_TOOLS' => '0'], function () {
        expect(fn () => Engines::skipUnlessTool('pg_dump'))->toThrow(SkippedWithMessageException::class, 'pg_dump not found');
    });
});

it('does not skip a tool that is installed', function () {
    config(['dbzuper.transfer_tools.pg_dump' => PHP_BINARY]);

    Engines::skipUnlessTool('pg_dump');

    expect(true)->toBeTrue();
});
