<?php

use App\Database\ConnectionFactory;
use App\Database\ConnectionTester;
use App\Models\User;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

/*
 * Runs against the MySQL/MariaDB test containers with a temporary account that may only log in over TLS
 * (REQUIRE SSL), so each result shows whether an SSL mode really encrypts. The containers' certificates are
 * self-signed and name no host, like a cloud database reached through an SSH tunnel on 127.0.0.1.
 */
const SSL_PROBE_USER = 'dbzuper_ssl_probe';
const SSL_PROBE_PASSWORD = 'ssl-probe-pw';
const UNRELATED_CA = 'tests/fixtures/tls/unrelated-ca.pem';

/** Runs $test with a TLS-only account on $engine, dropping the account afterwards. */
function withTlsOnlyUser(string $engine, Closure $test): void
{
    Engines::skipUnlessAvailable($engine);
    $pdo = Engines::pdo($engine);
    $user = "'".SSL_PROBE_USER."'@'%'";
    $pdo->exec("DROP USER IF EXISTS {$user}");
    $pdo->exec("CREATE USER {$user} IDENTIFIED BY '".SSL_PROBE_PASSWORD."' REQUIRE SSL");
    $pdo->exec('GRANT SELECT ON `'.Engines::DATABASE."`.* TO {$user}");

    try {
        $test(fn (array $options) => Engines::savedConnection($engine, [
            'username' => SSL_PROBE_USER, 'password' => SSL_PROBE_PASSWORD, 'options' => $options,
        ]));
    } finally {
        $pdo->exec("DROP USER IF EXISTS {$user}");
    }
}

it('cannot log a TLS-only account in when SSL is disabled', function (string $engine) {
    withTlsOnlyUser($engine, function (Closure $connection) {
        foreach ([['mysql_ssl' => 'disabled'], []] as $options) {
            $result = app(ConnectionTester::class)->test($connection($options));

            // The server answers a plain-text login of a REQUIRE SSL account with "access denied" (1045).
            expect($result['ok'])->toBeFalse()
                ->and($result['error']['kind'])->toBe('auth');
        }
    });
})->with(['mysql', 'mariadb']);

it('connects encrypted without checking the certificate in required mode', function (string $engine) {
    withTlsOnlyUser($engine, function (Closure $connection) {
        expect(app(ConnectionTester::class)->test($connection(['mysql_ssl' => 'required']))['ok'])->toBeTrue();

        $cipher = app(ConnectionFactory::class)->using(
            $connection(['mysql_ssl' => 'required']),
            fn (Connection $db) => ((array) $db->selectOne("SHOW STATUS LIKE 'Ssl_cipher'"))['Value'] ?? null,
        );
        expect($cipher)->toBeString()->not->toBeEmpty();
    });
})->with(['mysql', 'mariadb']);

it('still encrypts a saved connection that had a CA path with verification off', function (string $engine) {
    withTlsOnlyUser($engine, function (Closure $connection) {
        $result = app(ConnectionTester::class)->test($connection(['ssl_ca' => base_path(UNRELATED_CA), 'ssl_verify' => false]));

        expect($result['ok'])->toBeTrue();
    });
})->with(['mysql', 'mariadb']);

it('rejects a certificate the CA did not sign in verify identity mode, with a hint', function (string $engine) {
    withTlsOnlyUser($engine, function (Closure $connection) {
        $result = app(ConnectionTester::class)->test($connection(['mysql_ssl' => 'verify_identity', 'ssl_ca' => base_path(UNRELATED_CA)]));

        expect($result['ok'])->toBeFalse()
            ->and($result['error']['kind'])->toBe('connection')
            ->and($result['error']['reason'])->toBe('tls')
            ->and($result['error']['message'])->toContain('choose SSL mode Required');
    });
})->with(['mysql', 'mariadb']);

it('tests a connection through the endpoint with the same SSL mode it would save', function (string $engine) {
    withTlsOnlyUser($engine, function () use ($engine) {
        $p = Engines::params($engine);
        $payload = fn (string $mode) => [
            'name' => 'TLS', 'driver' => $engine, 'host' => $p['host'], 'port' => $p['port'], 'database' => $p['database'],
            'username' => SSL_PROBE_USER, 'password' => SSL_PROBE_PASSWORD, 'options' => ['mysql_ssl' => $mode],
        ];
        $this->actingAs(User::factory()->create());

        $this->postJson(route('connections.test'), $payload('required'))->assertOk()->assertJsonPath('ok', true);
        $this->postJson(route('connections.test'), $payload('disabled'))->assertOk()->assertJsonPath('ok', false);
    });
})->with(['mysql', 'mariadb']);
