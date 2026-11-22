<?php

use App\Transfers\Export\DumpObject;
use App\Transfers\Import\SqlPiece;
use App\Transfers\Native\MySqlPrivilegeProbe;
use App\Transfers\Native\NativeCommand;
use App\Transfers\Native\NativeExporter;
use App\Transfers\Native\NativeProcess;
use App\Transfers\Native\NativeRestorer;
use App\Transfers\Native\ToolCheck;
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

function npWindows(): bool
{
    return PHP_OS_FAMILY === 'Windows';
}

/**
 * Runs a PHP script as a dump "tool" over the transport the exporter uses on this platform: on Windows the tool
 * writes its own output file (tailed), elsewhere stdout is a pipe. The script writes to `$out`; its own arguments
 * start at $argv[2]. Returns [exit code, everything handed to the consumer].
 *
 * @param  (callable(): void)|null  $tick
 * @param  (callable(string): void)|null  $consumer  also called per chunk (e.g. a slow consumer)
 */
function npRun(string $code, array $env = [], ?callable $tick = null, array $args = [], ?callable $consumer = null, ?NativeProcess &$process = null): array
{
    $file = npWindows() ? sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-np-'.bin2hex(random_bytes(6)).'.out' : null;
    $prelude = '$out = $argv[1] === "-" ? STDOUT : fopen($argv[1], "wb");';
    $command = new NativeCommand([PHP_BINARY, '-r', $prelude.$code, '--', $file ?? '-', ...$args], $env, $file !== null ? [$file] : []);
    $received = '';
    $process = new NativeProcess($command);
    try {
        $exit = $process->run(function (string $chunk) use (&$received, $consumer) {
            $received .= $chunk;
            if ($consumer !== null) {
                $consumer($chunk);
            }
        }, $tick ?? fn () => null, outputFile: $file);
    } finally {
        $command->cleanup();
    }

    return [$exit, $received];
}

it('gives the child only the allow-listed environment and the command variables', function () {
    expect(NativeProcess::environment(['PGPASSWORD' => 'mine'], [
        'Path' => 'C:\\bin', 'SystemRoot' => 'C:\\Windows', 'TEMP' => 't', 'HOME' => '/h', 'LANG' => 'C.UTF-8',
        'APP_KEY' => 'base64:x', 'DB_PASSWORD' => 'p', 'PGHOST' => 'evil', 'PGSERVICE' => 'evil', 'MYSQL_PWD' => 'leak',
    ]))->toBe(['Path' => 'C:\\bin', 'SystemRoot' => 'C:\\Windows', 'TEMP' => 't', 'HOME' => '/h', 'LANG' => 'C.UTF-8', 'PGPASSWORD' => 'mine']);
});

it('starts the tool with nothing but the allow-listed environment', function () {
    $secrets = ['APP_KEY' => 'base64:secret', 'DB_PASSWORD' => 'db-secret', 'PGHOST' => 'evil.example', 'PGSERVICE' => 'evil', 'MYSQL_PWD' => 'leak', 'MYSQL_HOST' => 'evil.example'];
    npWithEnv($secrets, function () {
        [$exit, $out] = npRun('fwrite($out, json_encode(getenv()));', ['PGDATABASE' => 'shop']);
        $seen = json_decode($out, true);
        $allowed = ['PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'PGDATABASE'];

        expect($exit)->toBe(0)
            ->and(array_values(array_diff(array_map('strtoupper', array_keys($seen)), $allowed)))->toBe([])
            ->and($seen['PGDATABASE'])->toBe('shop')
            ->and(array_change_key_case($seen, CASE_UPPER))->toHaveKey('PATH');
    });
});

it('passes awkward arguments to the tool unchanged, without a shell', function () {
    $args = ['--table-and-children="Sales"."we""ird"', 'a b', '%PATH%', '$HOME', 'x"y\\', '!x!', '&& echo pwned', 'é東', ''];
    [$exit, $out] = npRun('fwrite($out, json_encode(array_slice($argv, 2)));', args: $args);

    expect($exit)->toBe(0)->and(json_decode($out, true))->toBe($args);
});

it('streams the output in bounded chunks, keeps the stderr tail and reports the exit code', function () {
    $largest = 0;
    [$exit, $out] = npRun(
        'fwrite(STDERR, str_repeat("x", 70000)."password=hunter2 tail"); fwrite($out, str_repeat("a", 300000)); exit(3);',
        consumer: function (string $chunk) use (&$largest) {
            $largest = max($largest, strlen($chunk));
        },
        process: $process,
    );

    expect($exit)->toBe(3)
        ->and(strlen($out))->toBe(300000)
        ->and($largest)->toBeLessThanOrEqual(65536)
        ->and(strlen($process->stderr()))->toBeLessThanOrEqual(65536)
        ->and(NativeProcess::sanitize($process->stderr(), 'hunter2'))->toEndWith('password=*** tail');
});

it('delivers every byte to a slow consumer when the tool exits right after writing', function () {
    // 24 MB of varied bytes written as fast as possible, then an immediate exit: the case that lost the tail of the
    // output over a Windows socket. The consumer sleeps on every chunk so the tool is long gone before it catches up.
    $code = 'for ($i = 0; $i < 3000; $i++) { $b = str_repeat(hash("sha256", (string) $i, true), 256); fwrite($out, $b); } exit(0);';
    $expected = hash_init('sha256');
    for ($i = 0; $i < 3000; $i++) {
        hash_update($expected, str_repeat(hash('sha256', (string) $i, true), 256));
    }
    $expected = hash_final($expected);

    for ($run = 0; $run < 3; $run++) {
        $hash = hash_init('sha256');
        $bytes = 0;
        $chunks = 0;
        $process = new NativeProcess(new NativeCommand([PHP_BINARY, '-r', '$out = $argv[1] === "-" ? STDOUT : fopen($argv[1], "wb");'.$code, '--', $file = (npWindows() ? sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-np-'.bin2hex(random_bytes(6)).'.out' : '-')]));
        try {
            $exit = $process->run(function (string $chunk) use ($hash, &$bytes, &$chunks) {
                hash_update($hash, $chunk);
                $bytes += strlen($chunk);
                if (++$chunks % 8 === 0) {
                    usleep(2_000);
                }
            }, fn () => null, outputFile: $file === '-' ? null : $file);
        } finally {
            if ($file !== '-') {
                @unlink($file);
            }
        }

        expect($exit)->toBe(0)
            ->and($bytes)->toBe(3000 * 8192)
            ->and(hash_final($hash))->toBe($expected);
    }
});

it('keeps memory flat for a large dump', function () {
    // 200 MB as fast as the child can write it.
    $bytes = 0;
    gc_collect_cycles();
    memory_reset_peak_usage();
    $baseline = memory_get_usage();
    $started = microtime(true);

    $file = npWindows() ? sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-np-'.bin2hex(random_bytes(6)).'.out' : null;
    $process = new NativeProcess(new NativeCommand([PHP_BINARY, '-r', '$out = $argv[1] === "-" ? STDOUT : fopen($argv[1], "wb"); $s = str_repeat("x", 1048576); for ($i = 0; $i < 200; $i++) { fwrite($out, $s); }', '--', $file ?? '-']));
    try {
        $exit = $process->run(function (string $chunk) use (&$bytes) {
            $bytes += strlen($chunk);
        }, fn () => null, outputFile: $file);
    } finally {
        if ($file !== null) {
            @unlink($file);
        }
    }
    $peak = memory_get_peak_usage() - $baseline;
    fwrite(STDERR, sprintf("[native-memory] %s transport: %d bytes in %.2f s, peak +%.2f MB\n", $file !== null ? 'file' : 'pipe', $bytes, microtime(true) - $started, $peak / 1048576));

    expect($exit)->toBe(0)
        ->and($bytes)->toBe(200 * 1048576)
        ->and($peak)->toBeLessThan(16 * 1048576);
});

it('refuses to read a tool output over a socket on Windows', function () {
    $process = new NativeProcess(new NativeCommand([PHP_BINARY, '-r', 'echo 1;']));

    expect(fn () => $process->run(fn () => null, fn () => null))->toThrow(LogicException::class);
})->skip(fn () => ! npWindows(), 'Windows only');

it('feeds stdin chunk by chunk and stops ticking once the input ended', function () {
    $result = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-stdin-'.bin2hex(random_bytes(4));
    $chunks = ['one ', 'two ', str_repeat('z', 3000000), ' end'];
    $asked = 0;
    $ended = false;
    $ticksAfterEnd = 0;
    $code = '$n = 0; while (($l = fread(STDIN, 65536)) !== false && $l !== "") { $n += strlen($l); } file_put_contents('.var_export($result, true).', $n);';
    try {
        $exit = (new NativeProcess(new NativeCommand([PHP_BINARY, '-r', $code])))->run(
            null,
            function () use (&$ended, &$ticksAfterEnd) {
                if ($ended) {
                    $ticksAfterEnd++;
                }
            },
            function () use (&$chunks, &$asked, &$ended) {
                $asked++;
                $next = array_shift($chunks);
                $ended = $next === null;

                return $next;
            },
        );

        expect($exit)->toBe(0)
            ->and((int) file_get_contents($result))->toBe(3000012)
            ->and($asked)->toBe(5)
            ->and($ticksAfterEnd)->toBe(0);
    } finally {
        @unlink($result);
    }
});

it('kills a quiet tool within two seconds of a cancel', function () {
    $started = microtime(true);
    $tick = function () use ($started) {
        if (microtime(true) - $started >= 1.0) {
            throw new TransferCancelled('Cancelled');
        }
    };

    expect(fn () => npRun('sleep(30);', tick: $tick))->toThrow(TransferCancelled::class);
    $elapsed = microtime(true) - $started;
    fwrite(STDERR, sprintf("[native-cancel] cancelled at 1.00 s, returned at %.2f s\n", $elapsed));
    expect($elapsed)->toBeLessThan(3.0);
});

it('kills the client with stdin still open when producing input fails', function () {
    $marker = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-eof-'.bin2hex(random_bytes(4));
    // The child writes the marker only if it ever sees the end of its input.
    $code = 'while (($l = fread(STDIN, 8192)) !== false && $l !== "") {} file_put_contents('.var_export($marker, true).', "eof");';
    $calls = 0;
    try {
        $process = new NativeProcess(new NativeCommand([PHP_BINARY, '-r', $code]));
        expect(fn () => $process->run(null, fn () => null, function () use (&$calls) {
            if (++$calls > 2) {
                throw new TransferCancelled('Cancelled');
            }

            return "chunk\n";
        }))->toThrow(TransferCancelled::class);
        usleep(300_000);
        expect(file_exists($marker))->toBeFalse();
    } finally {
        @unlink($marker);
    }
});

it('removes the options files of commands never cleaned up when the process dies', function () {
    $dir = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-shutdown-'.bin2hex(random_bytes(4));
    mkdir($dir);
    $file = $dir.DIRECTORY_SEPARATOR.'client.cnf';
    file_put_contents($file, 'password=x');
    $code = 'require '.var_export(base_path('vendor/autoload.php'), true).';'
        .' $c = new App\Transfers\Native\NativeCommand(["x"], [], ['.var_export($file, true).', '.var_export($dir, true).']);'
        .' undefined_function_dies_fatally();';

    $exit = (new NativeProcess(new NativeCommand([PHP_BINARY, '-r', $code])))->run(null, fn () => null);

    expect($exit)->not->toBe(0)
        ->and(file_exists($file))->toBeFalse()
        ->and(is_dir($dir))->toBeFalse();
});

it('accepts only a dump that ends with the tool trailer', function () {
    $pg = "--\n-- PostgreSQL database dump complete\n--\n\n\\unrestrict abc\n\n";
    $my = "/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;\n\n-- Dump completed on 2026-11-23 10:00:00\n";

    expect(NativeExporter::hasTrailer('pg_dump', $pg))->toBeTrue()
        ->and(NativeExporter::hasTrailer('pg_dump', "COPY public.t (id) FROM stdin;\n1\n2\n"))->toBeFalse()
        ->and(NativeExporter::hasTrailer('mysqldump', $my))->toBeTrue()
        ->and(NativeExporter::hasTrailer('mariadb-dump', "-- Dump completed\n"))->toBeTrue()
        ->and(NativeExporter::hasTrailer('mysqldump', 'INSERT INTO `t` VALUES (1),(2'))->toBeFalse()
        // A pg_dump trailer doesn't count for mysqldump and the other way round.
        ->and(NativeExporter::hasTrailer('mysqldump', $pg))->toBeFalse()
        ->and(NativeExporter::hasTrailer('pg_dump', $my))->toBeFalse();
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

it('knows which psql versions understand restrict', function (string $version, bool $knows) {
    expect(NativeRestorer::knowsRestrict(new ToolCheck(true, 'psql', '/x/psql', $version, '')))->toBe($knows);
})->with([
    ['19.0', true], ['18.0', true], ['17.6', true], ['17.5', false], ['16.10', true], ['16.9', false], ['15.14', true],
    ['15.13', false], ['14.19', true], ['14.18', false], ['13.22', true], ['13.21', false], ['12.22', false],
]);

it('names the gaps of a login without routine or event access', function () {
    expect(MySqlPrivilegeProbe::gaps(['routines' => false, 'events' => false]))
        ->toBe(['stored procedures and functions (no permission)', 'events (no permission)'])
        ->and(MySqlPrivilegeProbe::gaps(['routines' => true, 'events' => true]))->toBe([]);
});
