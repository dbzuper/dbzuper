<?php

use App\Transfers\Export\DumpObject;
use App\Transfers\Import\SqlPiece;
use App\Transfers\Native\MySqlPrivilegeProbe;
use App\Transfers\Native\NativeCommand;
use App\Transfers\Native\NativeExporter;
use App\Transfers\Native\NativeProcess;
use App\Transfers\Native\NativeRestorer;
use App\Transfers\TransferCancelled;
use Tests\TestCase;

uses(TestCase::class);

/** Sets variables the way a real parent environment has them (getenv, $_ENV and $_SERVER) for the callback. */
function npWithEnv(array $vars, Closure $callback): void
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

/** A PHP child that prints the named variables as JSON (false when unset). */
function npEnvProbe(array $names, array $env = []): NativeCommand
{
    $code = 'echo json_encode(array_map(fn ($n) => getenv($n), '.var_export($names, true).'));';

    return new NativeCommand([PHP_BINARY, '-r', $code], $env);
}

it('removes inherited PG and MYSQL variables and keeps the rest of the environment', function () {
    $env = NativeProcess::environment(['PGPASSWORD' => 'mine', 'PGDATABASE' => 'shop'], [
        'PATH', 'SYSTEMROOT', 'TEMP', 'PGSERVICE', 'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGUSER', 'PGPASSFILE', 'PGOPTIONS',
        'PGSSLMODE', 'PGSSLROOTCERT', 'PGDATABASE', 'PGPASSWORD', 'MYSQL_PWD', 'MYSQL_HOST', 'MYSQL_TCP_PORT', 'MYSQL_UNIX_PORT',
        'MARIADB_HOST', 'pghost',
    ]);

    expect($env)->toBe([
        'PGSERVICE' => false, 'PGHOST' => false, 'PGHOSTADDR' => false, 'PGPORT' => false, 'PGUSER' => false,
        'PGPASSFILE' => false, 'PGOPTIONS' => false, 'PGSSLMODE' => false, 'PGSSLROOTCERT' => false, 'PGDATABASE' => 'shop',
        'PGPASSWORD' => 'mine', 'MYSQL_PWD' => false, 'MYSQL_HOST' => false, 'MYSQL_TCP_PORT' => false,
        'MYSQL_UNIX_PORT' => false, 'MARIADB_HOST' => false, 'pghost' => false,
    ]);
});

it('starts the tool without the inherited connection variables', function () {
    npWithEnv(['PGHOST' => 'evil.example', 'PGSERVICE' => 'evil', 'MYSQL_PWD' => 'leak', 'MYSQL_HOST' => 'evil.example', 'DBZ_KEEP_ME' => 'kept'], function () {
        $out = '';
        $process = new NativeProcess(npEnvProbe(['PGHOST', 'PGSERVICE', 'MYSQL_PWD', 'MYSQL_HOST', 'DBZ_KEEP_ME', 'PATH', 'PGDATABASE'], ['PGDATABASE' => 'shop']));
        $exit = $process->run(function (string $chunk) use (&$out) {
            $out .= $chunk;
        }, fn () => null);

        $seen = json_decode($out, true);
        expect($exit)->toBe(0)
            ->and(array_slice($seen, 0, 5))->toBe([false, false, false, false, 'kept'])
            ->and($seen[5])->toBeString()->not->toBe('')
            ->and($seen[6])->toBe('shop');
    });
});

it('streams stdout in chunks, keeps the stderr tail and reports the exit code', function () {
    $code = 'fwrite(STDERR, str_repeat("x", 70000)."password=hunter2 tail"); echo str_repeat("a", 300000); exit(3);';
    $process = new NativeProcess(new NativeCommand([PHP_BINARY, '-r', $code]), 'hunter2');
    $bytes = 0;
    $chunks = 0;
    $exit = $process->run(function (string $chunk) use (&$bytes, &$chunks) {
        $bytes += strlen($chunk);
        $chunks++;
    }, fn () => null);

    expect($exit)->toBe(3)
        ->and($bytes)->toBe(300000)
        ->and(strlen($process->stderr()))->toBeLessThanOrEqual(65536)
        ->and($process->stderr())->toEndWith('password=*** tail')
        ->and($process->stderr())->not->toContain('hunter2');
});

it('stops the process when the tick throws', function () {
    $process = new NativeProcess(new NativeCommand([PHP_BINARY, '-r', 'sleep(30);']));
    $started = microtime(true);

    expect(fn () => $process->run(fn () => null, fn () => throw new TransferCancelled('Cancelled')))
        ->toThrow(TransferCancelled::class);
    expect(microtime(true) - $started)->toBeLessThan(10);
});

it('strips credentials from tool messages', function () {
    $text = "pg_dump: error: connection failed: password=\"s3cr3t pw\" PGPASSWORD=abc host=x\n"
        ."mysqldump: Got error: 1045: Access denied for user 'u'@'h' (using password: YES)\nthe raw s3cr3t pw too";

    expect(NativeProcess::sanitize($text, 's3cr3t pw'))->toBe(
        "pg_dump: error: connection failed: password=*** PGPASSWORD=*** host=x\n"
        ."mysqldump: Got error: 1045: Access denied for user 'u'@'h' (using password: YES)\nthe raw *** too",
    );
});

it('expands chosen partitioned tables into their partitions, recursively', function () {
    $t = fn (string $name, ?string $schema = 'public') => new DumpObject($schema, $name, 'table');
    $partitions = [
        $t('m')->key() => [$t('m_2024'), $t('m_2025')],
        $t('m_2025')->key() => [$t('m_2025_h1'), $t('m_2025_h2')],
        $t('other')->key() => [$t('other_a')],
    ];

    $expanded = NativeExporter::withPartitions([$t('m'), $t('plain'), $t('m_2024')], $partitions);

    expect(array_map(fn (DumpObject $o) => $o->name, $expanded))
        ->toBe(['m', 'plain', 'm_2024', 'm_2025', 'm_2025_h1', 'm_2025_h2']);
});

it('serialises pieces for the native client', function () {
    expect(NativeRestorer::text(new SqlPiece('sql', 'CREATE TABLE a (x int)', ';', 1)))->toBe("CREATE TABLE a (x int);\n")
        ->and(NativeRestorer::text(new SqlPiece('sql', 'CREATE TRIGGER t BEGIN SET x = 1; END', ';;', 2)))->toBe("CREATE TRIGGER t BEGIN SET x = 1; END;;\n")
        ->and(NativeRestorer::text(new SqlPiece('meta', '\\connect shop')))->toBe("\\connect shop\n")
        ->and(NativeRestorer::text(new SqlPiece('copy_data', "1\tx\n\\.\n")))->toBe("1\tx\n\\.\n")
        ->and(NativeRestorer::text(new SqlPiece('delimiter', ';;', ';;')))->toBe("DELIMITER ;;\n")
        // A statement ending in a line comment: the delimiter goes on its own line, not into the comment.
        ->and(NativeRestorer::text(new SqlPiece('sql', 'SELECT 1 -- note', ';', 3)))->toBe("SELECT 1 -- note\n;\n")
        ->and(NativeRestorer::text(new SqlPiece('sql', 'SELECT 1 # note', ';', 4)))->toBe("SELECT 1 # note\n;\n");
});

it('names the gaps of a login without routine or event access', function () {
    expect(MySqlPrivilegeProbe::gaps(['routines' => false, 'events' => false]))
        ->toBe(['stored procedures and functions (no permission)', 'events (no permission)'])
        ->and(MySqlPrivilegeProbe::gaps(['routines' => true, 'events' => true]))->toBe([]);
});
