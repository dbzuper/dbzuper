<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Transfers\Export\DumpObject;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Native\NativeCommand;
use App\Transfers\Native\NativeCommandBuilder;
use App\Transfers\Native\ToolCheck;
use Tests\TestCase;

uses(TestCase::class);

$GLOBALS['ncbCommands'] = [];

afterEach(function () {
    foreach ($GLOBALS['ncbCommands'] as $command) {
        $command->cleanup();
    }
    $GLOBALS['ncbCommands'] = [];
});

function ncbDump(...$args): NativeCommand
{
    return $GLOBALS['ncbCommands'][] = NativeCommandBuilder::dump(...$args);
}

function ncbRestore(...$args): NativeCommand
{
    return $GLOBALS['ncbCommands'][] = NativeCommandBuilder::restore(...$args);
}

const NCB_PASSWORD = 'p#ss"w\\ord =1 secret';

function ncbConnection(DriverName $driver, array $options = [], ?string $password = NCB_PASSWORD): SavedConnection
{
    return new SavedConnection([
        'name' => 'x',
        'driver' => $driver,
        'host' => 'db.example.test',
        'port' => 3307,
        'database' => 'shop',
        'username' => 'app_user',
        'password' => $password,
        'options' => $options,
    ]);
}

function ncbTool(string $tool, string $version): ToolCheck
{
    return new ToolCheck(true, $tool, '/usr/bin/'.$tool, $version, "{$tool} {$version}");
}

function ncbOptions(bool $structure = true, bool $data = true, bool $drop = false, ?array $tables = null): ExportOptions
{
    return new ExportOptions($tables, $structure, $data, $drop, false);
}

dataset('ncb engines', [
    'mysql' => [DriverName::MySql, 'mysqldump', 'mysql'],
    'mariadb' => [DriverName::MariaDb, 'mariadb-dump', 'mariadb'],
    'pgsql' => [DriverName::Postgres, 'pg_dump', 'psql'],
]);

it('never puts the password in argv', function (DriverName $driver, string $dumpTool, string $restoreTool) {
    $c = ncbConnection($driver);
    $dump = ncbDump($c, ncbTool($dumpTool, '17.0'), ncbOptions(tables: ['a']), [new DumpObject($driver === DriverName::Postgres ? 'public' : null, 'a', 'table')], true, true);
    $restore = ncbRestore($c, ncbTool($restoreTool, '17.0'));

    foreach ([$dump, $restore] as $command) {
        foreach ($command->argv as $arg) {
            expect($arg)->not->toContain('p#ss')->and($arg)->not->toContain('secret');
        }
        foreach ($command->env as $key => $value) {
            if ($key !== 'PGPASSWORD') {
                expect($value)->not->toContain('secret');
            }
        }
        if ($driver === DriverName::Postgres) {
            expect($command->env['PGPASSWORD'])->toBe(NCB_PASSWORD);
        }
        $command->cleanup();
    }
})->with('ncb engines');

it('omits PGPASSWORD when no password is set', function () {
    $command = ncbRestore(ncbConnection(DriverName::Postgres, [], null), ncbTool('psql', '17.0'));

    expect($command->env)->not->toHaveKey('PGPASSWORD')->and($command->env['PGSSLMODE'])->toBe('prefer');
});

it('writes a 0600 defaults file and cleans it up', function () {
    $command = ncbRestore(ncbConnection(DriverName::MySql), ncbTool('mysql', '8.4.2'));

    expect($command->argv[1])->toStartWith('--defaults-file=');
    $file = substr($command->argv[1], strlen('--defaults-file='));
    expect(is_file($file))->toBeTrue();
    if (PHP_OS_FAMILY !== 'Windows') {
        expect(fileperms($file) & 0777)->toBe(0600)
            ->and(fileperms(dirname($file)) & 0777)->toBe(0700);
    }
    $content = file_get_contents($file);
    expect($content)->toContain('[client]')
        ->and($content)->toContain('user="app_user"')
        ->and($content)->toContain('password="p#ss\\"w\\\\ord =1 secret"')
        ->and($content)->toContain('host="db.example.test"')
        ->and($content)->toContain('port="3307"');

    $command->cleanup();
    expect(file_exists($file))->toBeFalse()->and(is_dir(dirname($file)))->toBeFalse();
});

it('maps ssl options into the defaults file', function (DriverName $driver, array $options, array $expected) {
    $command = ncbRestore(ncbConnection($driver, $options), ncbTool('mysql', '8.4.2'));
    $content = file_get_contents(substr($command->argv[1], strlen('--defaults-file=')));
    $command->cleanup();

    foreach ($expected as $line) {
        expect($content)->toContain($line);
    }
})->with([
    'mysql off' => [DriverName::MySql, [], ['ssl-mode=DISABLED', 'get-server-public-key=1']],
    'mysql required' => [DriverName::MySql, ['mysql_ssl' => 'required'], ['ssl-mode=REQUIRED']],
    'mysql verify' => [DriverName::MySql, ['mysql_ssl' => 'verify_identity', 'ssl_ca' => '/ca.pem'], ['ssl-mode=VERIFY_IDENTITY', 'ssl-ca="/ca.pem"']],
    'maria required' => [DriverName::MariaDb, ['mysql_ssl' => 'required'], ['ssl=1', 'ssl-verify-server-cert=0']],
    'maria verify' => [DriverName::MariaDb, ['mysql_ssl' => 'verify_identity', 'ssl_ca' => '/ca.pem'], ['ssl-verify-server-cert=1', 'ssl-ca="/ca.pem"']],
]);

it('quotes awkward table names for pg_dump', function () {
    $objects = [new DumpObject('Sales', 'order', 'table'), new DumpObject('Sales', 'we"ird', 'table'), new DumpObject('public', 'a*b?.c', 'table')];
    $c = ncbConnection(DriverName::Postgres);

    $old = ncbDump($c, ncbTool('pg_dump', '15.4'), ncbOptions(tables: ['x']), $objects, false, false);
    expect($old->argv)->toContain('-t')
        ->and($old->argv)->toContain('"Sales"."order"')
        ->and($old->argv)->toContain('"Sales"."we""ird"')
        ->and($old->argv)->toContain('"public"."a*b?.c"');

    $new = ncbDump($c, ncbTool('pg_dump', '17.0'), ncbOptions(tables: ['x']), $objects, false, false);
    expect($new->argv)->toContain('--table-and-children="Sales"."we""ird"')
        ->and($new->argv)->not->toContain('-t');
});

it('maps schema/data/drop options to flags', function () {
    $c = ncbConnection(DriverName::Postgres);
    $pg = fn (ExportOptions $o) => ncbDump($c, ncbTool('pg_dump', '17.0'), $o, [], false, false)->argv;

    expect($pg(ncbOptions()))->toContain('--format=plain', '--no-owner', '--no-privileges', '--host=db.example.test', '--port=3307', '--username=app_user')
        ->and($pg(ncbOptions(data: false)))->toContain('--schema-only')
        ->and($pg(ncbOptions(structure: false)))->toContain('--data-only')
        ->and($pg(ncbOptions(drop: true)))->toContain('--clean', '--if-exists')
        ->and($pg(ncbOptions()))->not->toContain('--clean');

    $my = fn (DriverName $d, ExportOptions $o, bool $r = false, bool $e = false) => ncbDump(ncbConnection($d), ncbTool('mysqldump', '8.4.2'), $o, [new DumpObject(null, 't1', 'table')], $r, $e)->argv;

    $argv = $my(DriverName::MySql, ncbOptions(drop: true), true, true);
    expect($argv[1])->toStartWith('--defaults-file=')
        ->and($argv[2])->toBe('--no-login-paths')
        ->and($argv)->toContain('--comments')
        ->and($argv)->toContain('--single-transaction', '--no-tablespaces', '--routines', '--triggers', '--events', '--add-drop-table', '--hex-blob', '--default-character-set=utf8mb4', '--set-gtid-purged=OFF')
        ->and($argv)->not->toContain('--column-statistics=0')
        ->and(array_slice($argv, -2))->toBe(['--', 'shop']);

    $argv = $my(DriverName::MySql, ncbOptions(), false, false);
    expect($argv)->toContain('--skip-add-drop-table')->and($argv)->not->toContain('--routines', '--events');

    $argv = $my(DriverName::MariaDb, ncbOptions(structure: false, data: true));
    expect($argv)->toContain('--no-create-info', '--skip-triggers')->and($argv)->not->toContain('--set-gtid-purged=OFF');

    expect($my(DriverName::MySql, ncbOptions(data: false)))->toContain('--no-data');

    $argv = $my(DriverName::MySql, ncbOptions(tables: ['t1']));
    expect(array_slice($argv, -3))->toBe(['--', 'shop', 't1']);
});

it('builds restore commands', function () {
    $psql = ncbRestore(ncbConnection(DriverName::Postgres), ncbTool('psql', '17.0'));
    expect($psql->argv)->toBe(['/usr/bin/psql', '-X', '-q', '--no-password', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '--host=db.example.test', '--port=3307', '--username=app_user']);

    $my = ncbRestore(ncbConnection(DriverName::MariaDb), ncbTool('mariadb', '11.4.2'));
    expect($my->argv)->not->toContain('--no-login-paths')
        ->and(array_slice($my->argv, 2))->toBe(['--database=shop', '--default-character-set=utf8mb4', '--binary-mode', '--sandbox']);
    $my->cleanup();
});

it('never prompts for a password in pg_dump', function () {
    expect(ncbDump(ncbConnection(DriverName::Postgres), ncbTool('pg_dump', '18.0'), ncbOptions(), [], false, false)->argv)->toContain('--no-password');
});

it('turns off client shell commands where the client supports it', function (DriverName $driver, string $tool, string $version, ?string $flag) {
    $argv = ncbRestore(ncbConnection($driver), ncbTool($tool, $version))->argv;
    $flags = array_values(array_intersect($argv, ['--sandbox', '--system-command=OFF']));

    expect($flags)->toBe($flag === null ? [] : [$flag]);
})->with([
    'mysql 8.4.0' => [DriverName::MySql, 'mysql', '8.4.0', null],
    'mysql 8.4.3' => [DriverName::MySql, 'mysql', '8.4.3', '--system-command=OFF'],
    'mysql 8.0.39' => [DriverName::MySql, 'mysql', '8.0.39', null],
    'mysql 8.0.40' => [DriverName::MySql, 'mysql', '8.0.40', '--system-command=OFF'],
    'mysql 9.0.1' => [DriverName::MySql, 'mysql', '9.0.1', null],
    'mysql 9.1.0' => [DriverName::MySql, 'mysql', '9.1.0', '--system-command=OFF'],
    'mariadb 10.5.24' => [DriverName::MariaDb, 'mariadb', '10.5.24', null],
    'mariadb 10.5.25' => [DriverName::MariaDb, 'mariadb', '10.5.25', '--sandbox'],
    'mariadb 10.6.18' => [DriverName::MariaDb, 'mariadb', '10.6.18', '--sandbox'],
    'mariadb 10.11.7' => [DriverName::MariaDb, 'mariadb', '10.11.7', null],
    'mariadb 10.11.8' => [DriverName::MariaDb, 'mariadb', '10.11.8', '--sandbox'],
    'mariadb 11.3.2' => [DriverName::MariaDb, 'mariadb', '11.3.2', null],
    'mariadb 11.4.1' => [DriverName::MariaDb, 'mariadb', '11.4.1', null],
    'mariadb 11.4.2' => [DriverName::MariaDb, 'mariadb', '11.4.2', '--sandbox'],
    'mariadb 12.3.3' => [DriverName::MariaDb, 'mariadb', '12.3.3', '--sandbox'],
]);

it('keeps awkward database and table names out of option position', function () {
    $c = ncbConnection(DriverName::MySql);
    $c->setAttribute('database', '-weird');
    $argv = ncbDump($c, ncbTool('mysqldump', '8.4.2'), ncbOptions(tables: ['t']), [new DumpObject(null, '--where=0', 'table')], false, false)->argv;
    expect(array_slice($argv, -3))->toBe(['--', '-weird', '--where=0']);
});

it('passes a database named like a conninfo string via PGDATABASE only', function () {
    $c = ncbConnection(DriverName::Postgres);
    $c->setAttribute('database', 'host=x');
    foreach ([ncbRestore($c, ncbTool('psql', '17.0')), ncbDump($c, ncbTool('pg_dump', '17.0'), ncbOptions(), [], false, false)] as $command) {
        expect($command->env['PGDATABASE'])->toBe('host=x');
        foreach ($command->argv as $arg) {
            expect($arg)->not->toContain('host=x')->and($arg)->not->toStartWith('--dbname');
        }
    }
});

it('lets the dump tool write its own output file, deleted with the command', function () {
    $out = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-out-'.bin2hex(random_bytes(4)).'.sql';

    $pg = ncbDump(ncbConnection(DriverName::Postgres), ncbTool('pg_dump', '18.0'), ncbOptions(), [], false, false, $out);
    expect($pg->argv)->toContain('--file='.$out)->and($pg->tempFiles)->toBe([$out]);

    $my = ncbDump(ncbConnection(DriverName::MySql), ncbTool('mysqldump', '8.4.2'), ncbOptions(), [], false, false, $out);
    $dashes = array_search('--', $my->argv, true);
    expect(array_search('--result-file='.$out, $my->argv, true))->toBeLessThan($dashes)
        ->and($my->tempFiles[0])->toBe($out)
        ->and(count($my->tempFiles))->toBe(3);

    file_put_contents($out, 'x');
    $my->cleanup();
    expect(file_exists($out))->toBeFalse();
});

it('keeps the dump comments the trailer check relies on', function (DriverName $driver, string $tool) {
    $argv = ncbDump(ncbConnection($driver), ncbTool($tool, $driver === DriverName::MariaDb ? '11.4.2' : '18.0'), ncbOptions(), [], true, true)->argv;

    expect(array_filter($argv, fn (string $a) => in_array($a, ['--skip-comments', '--compact', '--skip-dump-date', '--comments=0', '--comments=false'], true)))->toBe([]);
})->with([
    'mysql' => [DriverName::MySql, 'mysqldump'],
    'mariadb' => [DriverName::MariaDb, 'mariadb-dump'],
    'pgsql' => [DriverName::Postgres, 'pg_dump'],
]);
