<?php

use App\Enums\DriverName;
use App\Enums\TransferMethod;
use App\Transfers\Import\RestoreFilter;
use App\Transfers\Import\RestoreRefused;
use App\Transfers\Import\SqlPiece;

function rfSql(string $text): SqlPiece
{
    return new SqlPiece('sql', $text);
}

function rfMeta(string $text): SqlPiece
{
    return new SqlPiece('meta', $text);
}

/**
 * @param  list<SqlPiece>  $pieces
 * @return list<string> texts that survive the filter
 */
function rfRun(DriverName $driver, TransferMethod $method, array $pieces): array
{
    $filter = new RestoreFilter($driver, 'open_db', $method);

    return array_map(fn (SqlPiece $p) => $p->text, iterator_to_array($filter->apply($pieces), false));
}

/** @param list<string> $statements */
function rfMy(array $statements, TransferMethod $method = TransferMethod::Builtin, DriverName $driver = DriverName::MySql): array
{
    return rfRun($driver, $method, array_map('rfSql', $statements));
}

/** @param list<SqlPiece> $pieces */
function rfPg(array $pieces, TransferMethod $method = TransferMethod::Builtin): array
{
    return rfRun(DriverName::Postgres, $method, $pieces);
}

it('removes USE with any quoting', function () {
    expect(rfMy(['USE `a`', 'USE a', "-- c\nuse  `a` ", 'SELECT 1']))->toBe(['SELECT 1']);
    expect(rfPg([rfSql('USE "a"')]))->toBe([]);
});

it('allows the same USE target twice', function () {
    expect(rfMy(['USE `a`', 'SELECT 1', 'USE `a`']))->toBe(['SELECT 1']);
});

it('refuses a second, different USE target', function () {
    rfMy(['USE `a`', 'USE `b`']);
})->throws(RestoreRefused::class, 'This file restores more than one database (a and b). Restore one database per file.');

it('compares MySQL targets case-insensitively but PostgreSQL exactly', function () {
    expect(rfMy(['USE `Shop`', 'USE `shop`'], driver: DriverName::MariaDb))->toBe([]);
    expect(fn () => rfPg([rfSql('USE "Shop"'), rfSql('USE "shop"')]))->toThrow(RestoreRefused::class);
});

it('removes CREATE DATABASE with backtick names like my-db', function () {
    expect(rfMy(['CREATE DATABASE `my-db`', 'CREATE DATABASE IF NOT EXISTS `my-db` /*!40100 DEFAULT CHARACTER SET utf8mb4 */', 'SELECT 1']))
        ->toBe(['SELECT 1']);
});

it('removes mysqldump CREATE DATABASE with the executable IF NOT EXISTS comment and counts it as a target', function () {
    expect(rfMy(['CREATE DATABASE /*!32312 IF NOT EXISTS*/ `a` /*!40100 DEFAULT CHARACTER SET utf8mb4 */', 'USE `a`']))->toBe([]);
    expect(fn () => rfMy(['CREATE DATABASE /*!32312 IF NOT EXISTS*/ `a`', 'USE `b`']))->toThrow(RestoreRefused::class);
});

it('handles doubled backticks inside a name', function () {
    expect(fn () => rfMy(['USE `a``b`', 'USE `a`']))->toThrow(RestoreRefused::class, '(a`b and a)');
});

it('removes CREATE SCHEMA on MySQL but keeps it on PostgreSQL', function () {
    expect(rfMy(['CREATE SCHEMA `x`', 'DROP SCHEMA IF EXISTS `x`'], driver: DriverName::MariaDb))->toBe([]);
    expect(rfPg([rfSql('CREATE SCHEMA "Sales"'), rfSql('CREATE SCHEMA IF NOT EXISTS sales2')]))
        ->toBe(['CREATE SCHEMA "Sales"', 'CREATE SCHEMA IF NOT EXISTS sales2']);
});

it('keeps CREATE SCHEMA', function () {
    expect(rfPg([rfSql('create schema app')]))->toBe(['create schema app']);
});

it('counts DROP DATABASE as a target', function () {
    rfMy(['DROP DATABASE IF EXISTS `a`', 'DROP DATABASE b']);
})->throws(RestoreRefused::class, '(a and b)');

it('removes a lone DROP DATABASE', function () {
    expect(rfMy(['DROP DATABASE IF EXISTS `a`', 'SELECT 1']))->toBe(['SELECT 1']);
    expect(rfPg([rfSql('DROP DATABASE IF EXISTS "a"'), rfSql('CREATE DATABASE a'), rfSql('SELECT 1')]))->toBe(['SELECT 1']);
});

it('does not remove other statements that merely mention database', function () {
    $keep = ['CREATE TABLE `database` (id int)', 'DROP TABLE `use`'];
    expect(rfMy($keep))->toBe($keep);
});

it('removes psql connect forms and refuses a different target', function () {
    expect(rfPg([rfMeta('\connect a'), rfMeta('\c a'), rfMeta('\connect -reuse-previous=on "dbname=\'a\'"'), rfMeta('\c "a"')], TransferMethod::Native))->toBe([]);
    expect(fn () => rfPg([rfMeta('\connect a'), rfMeta('\c "My Db"')], TransferMethod::Native))
        ->toThrow(RestoreRefused::class, '(a and My Db)');
});

it('does not mistake \copy for \c', function () {
    expect(fn () => rfPg([rfMeta('\copy t from x')], TransferMethod::Native))->toThrow(RestoreRefused::class, '(\copy)');
});

it('ignores connect without a database and refuses an unparseable one only after a target was seen', function () {
    expect(rfPg([rfMeta('\connect -'), rfMeta('\connect')], TransferMethod::Native))->toBe([]);
    expect(fn () => rfPg([rfSql('USE a'), rfMeta('\connect "dbname=\'b\'"')], TransferMethod::Native))->toThrow(RestoreRefused::class, '(a and b)');
    expect(fn () => rfPg([rfSql('USE a'), rfMeta('\connect -reuse-previous=on host=x')], TransferMethod::Native))
        ->toThrow(RestoreRefused::class, 'more than one database');
});

it('removes transaction statements on PostgreSQL and SQLite only', function () {
    $tx = ['BEGIN', 'BEGIN TRANSACTION', 'begin work', 'START TRANSACTION', 'START TRANSACTION ISOLATION LEVEL SERIALIZABLE', 'COMMIT', 'COMMIT WORK', 'COMMIT TRANSACTION', 'END', 'END TRANSACTION', 'ROLLBACK', 'ROLLBACK TRANSACTION', 'BEGIN IMMEDIATE'];
    expect(rfRun(DriverName::Postgres, TransferMethod::Builtin, array_map('rfSql', $tx)))->toBe([]);
    expect(rfRun(DriverName::Sqlite, TransferMethod::Builtin, array_map('rfSql', $tx)))->toBe([]);
    expect(rfMy(['BEGIN', 'COMMIT', 'START TRANSACTION']))->toBe(['BEGIN', 'COMMIT', 'START TRANSACTION']);
});

it('leaves savepoints and other statements that start like transactions', function () {
    $keep = ['SAVEPOINT a', 'RELEASE SAVEPOINT a', 'ROLLBACK TO SAVEPOINT a', 'BEGINNING()', 'ENDING', "COMMIT PREPARED 'x'"];
    expect(rfRun(DriverName::Postgres, TransferMethod::Builtin, array_map('rfSql', $keep)))->toBe($keep);
});

it('removes restrict and unrestrict meta lines on both methods', function () {
    foreach ([TransferMethod::Builtin, TransferMethod::Native] as $method) {
        expect(rfPg([rfMeta('\restrict abc'), rfSql('SELECT 1'), rfMeta('\unrestrict abc')], $method))->toBe(['SELECT 1']);
    }
});

it('refuses other meta lines and COPY data on the built-in method', function () {
    $msg = 'This file uses psql-only commands (COPY … FROM stdin); restore it with the native method (needs psql)';
    expect(fn () => rfPg([rfMeta('\set x 1')]))->toThrow(RestoreRefused::class, $msg);
    expect(fn () => rfPg([new SqlPiece('copy_data', "1\t2\n\\.\n")]))->toThrow(RestoreRefused::class, $msg);
});

it('refuses the COPY … FROM stdin statement itself on the built-in method, before it can run', function () {
    $msg = 'This file uses psql-only commands (COPY … FROM stdin); restore it with the native method (needs psql)';
    $seen = [];
    $filter = new RestoreFilter(DriverName::Postgres, 'open_db', TransferMethod::Builtin);
    $pieces = [rfSql('CREATE TABLE t (x int)'), rfSql("-- data\nCOPY \"Sales\".\"order\" (id, \"we\"\"ird\") FROM stdin"), new SqlPiece('copy_data', "1\n\\.\n")];

    expect(function () use ($filter, $pieces, &$seen) {
        foreach ($filter->apply($pieces) as $piece) {
            $seen[] = $piece->text;
        }
    })->toThrow(RestoreRefused::class, $msg);
    expect($seen)->toBe(['CREATE TABLE t (x int)'])
        // COPY from a file or to stdout is plain SQL and passes.
        ->and(rfPg([rfSql("COPY t FROM '/tmp/x.csv'"), rfSql('COPY t TO STDOUT'), rfSql("COPY (SELECT 'x FROM stdin') TO STDOUT")]))
        ->toBe(["COPY t FROM '/tmp/x.csv'", 'COPY t TO STDOUT', "COPY (SELECT 'x FROM stdin') TO STDOUT"]);
});

it('passes every COPY data piece through on the native method', function () {
    $pieces = [rfSql('COPY t FROM stdin'), new SqlPiece('copy_data', "1\n"), new SqlPiece('copy_data', "\\.\n")];
    expect(rfPg($pieces, TransferMethod::Native))->toBe(['COPY t FROM stdin', "1\n", "\\.\n"]);
});

it('refuses every psql meta command but restrict and connect on the native method', function (string $line, string $name) {
    $msg = "This file contains psql commands DBZuper won't run ({$name}). Remove them or restore with the built-in method.";
    expect(fn () => rfPg([rfSql('SELECT 1'), rfMeta($line)], TransferMethod::Native))->toThrow(RestoreRefused::class, $msg);
})->with([
    ['\! echo pwned', '\!'],
    ['\!echo pwned', '\!'],
    ['\o /tmp/x', '\o'],
    ['\w /tmp/x', '\w'],
    ['\g /tmp/x', '\g'],
    ['\copy t from x', '\copy'],
    ['\i /etc/passwd', '\i'],
    ['\ir x.sql', '\ir'],
    ['\setenv PGHOST x', '\setenv'],
    ['\gexec', '\gexec'],
    ['\lo_import /etc/passwd', '\lo_import'],
    ['\set x 1', '\set'],
]);

it('refuses psql backslash commands hidden inside a statement on the native method', function () {
    $msg = "This file contains psql commands DBZuper won't run (\\!). Remove them or restore with the built-in method.";
    expect(fn () => rfPg([rfSql('SELECT 1 \! echo pwned')], TransferMethod::Native))->toThrow(RestoreRefused::class, $msg);
    expect(fn () => rfPg([rfSql("INSERT INTO t VALUES ('a')\n\\! echo pwned")], TransferMethod::Native))->toThrow(RestoreRefused::class, $msg);

    // Backslashes inside literals, quoted names, dollar quotes and comments are data, not commands.
    $fine = [
        "INSERT INTO t VALUES ('a\\b', E'c\\'d\\\\', \"we\\ird\")",
        'CREATE FUNCTION f() RETURNS text AS $body$ SELECT \'\! no\' $body$ LANGUAGE sql',
        "SELECT 1 -- a \\! comment\n",
        'SELECT /* \! /* nested */ \o */ 1',
    ];
    expect(rfPg(array_map('rfSql', $fine), TransferMethod::Native))->toBe($fine);
});

it('keeps restrict lines for a psql that knows them and strips them otherwise', function () {
    $pieces = [rfMeta('\restrict abc'), rfSql('SELECT 1'), rfMeta('\unrestrict abc')];
    $out = fn (bool $keep) => array_map(
        fn (SqlPiece $p) => $p->text,
        iterator_to_array((new RestoreFilter(DriverName::Postgres, 'open_db', TransferMethod::Native, $keep))->apply($pieces), false),
    );

    expect($out(true))->toBe(['\restrict abc', 'SELECT 1', '\unrestrict abc'])
        ->and($out(false))->toBe(['SELECT 1']);
});

it('refuses mysql client commands on the native method', function (string $sql) {
    expect(fn () => rfMy(['CREATE TABLE t (x int)', $sql], TransferMethod::Native))
        ->toThrow(RestoreRefused::class, "This file contains mysql client commands DBZuper won't run");
})->with([
    'system echo x', 'SYSTEM echo x', '\! echo x', '\. /etc/passwd', '\T /tmp/x', '\P less', '\u other', '\r',
    'source /etc/passwd', 'tee /tmp/x', 'notee', 'pager less', 'nopager', 'edit', 'prompt x', 'connect other', 'charset latin1',
    'warnings', 'nowarnings', 'rehash', 'resetconnection', 'query_attributes a b', 'ssl_session_data_print', 'exit', 'quit',
    'go', 'ego', 'print', 'status', 'help', '/* x */ system echo x',
]);

it('keeps ordinary MySQL statements that only start like client commands', function () {
    $keep = ['SELECT 1', 'systematic_view', 'INSERT INTO system_log VALUES (1)', "SET @x = 'system echo'", 'CREATE TABLE `go` (x int)'];
    expect(rfMy($keep, TransferMethod::Native))->toBe($keep)
        // The built-in method sends it to the server, which rejects it.
        ->and(rfMy(['system echo x']))->toBe(['system echo x']);
});

it('passes delimiter pieces through', function () {
    $d = new SqlPiece('delimiter', '$$', '$$');
    $out = iterator_to_array((new RestoreFilter(DriverName::MySql, 'x', TransferMethod::Builtin))->apply([$d]), false);
    expect($out)->toEqual([$d]);
});

it('removes the executable-comment DROP DATABASE that mysqldump --add-drop-database writes', function () {
    expect(rfMy(['/*!40000 DROP DATABASE IF EXISTS `shop`*/', 'SELECT 1']))->toBe(['SELECT 1']);
    expect(rfMy(['/*M!100000 DROP DATABASE IF EXISTS `shop`*/'], driver: DriverName::MariaDb))->toBe([]);
    expect(rfMy(['/*!40000 DROP DATABASE IF EXISTS `shop`*/', 'CREATE DATABASE /*!32312 IF NOT EXISTS*/ `shop`', 'USE `shop`']))->toBe([]);
    expect(fn () => rfMy(['/*!40000 DROP DATABASE IF EXISTS `shop`*/', 'USE `other`']))->toThrow(RestoreRefused::class, '(shop and other)');
});

it('keeps executable comments that are not removable', function () {
    $keep = ['/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */', '/*!40000 ALTER TABLE `t` DISABLE KEYS */'];
    expect(rfMy($keep))->toBe($keep);
});

it('removes ALTER DATABASE and counts it as a target', function () {
    expect(rfMy(['ALTER DATABASE `shop` CHARACTER SET latin1 COLLATE latin1_swedish_ci', 'ALTER SCHEMA `shop` DEFAULT CHARACTER SET utf8mb4', '/*!50003 ALTER DATABASE `shop` CHARACTER SET utf8 */']))->toBe([]);
    expect(rfPg([rfSql('ALTER DATABASE shop OWNER TO app'), rfSql('ALTER DATABASE shop SET search_path TO a'), rfSql("COMMENT ON DATABASE shop IS 'x'")]))->toBe([]);
    expect(fn () => rfPg([rfSql('ALTER DATABASE shop OWNER TO app'), rfSql('ALTER DATABASE "Other" SET x = 1')]))->toThrow(RestoreRefused::class, '(shop and Other)');
    expect(fn () => rfMy(['ALTER DATABASE `a` CHARACTER SET x', 'USE `b`']))->toThrow(RestoreRefused::class);
});

it('keeps a nameless MySQL ALTER DATABASE and PostgreSQL ALTER SCHEMA', function () {
    expect(rfMy(['ALTER DATABASE CHARACTER SET utf8mb4', 'ALTER DATABASE DEFAULT COLLATE x']))->toBe(['ALTER DATABASE CHARACTER SET utf8mb4', 'ALTER DATABASE DEFAULT COLLATE x']);
    expect(rfPg([rfSql('ALTER SCHEMA s OWNER TO app')]))->toBe(['ALTER SCHEMA s OWNER TO app']);
});

it('ignores trailing comments when classifying', function () {
    expect(rfMy(['USE `a` /* c */', 'CREATE DATABASE `a` -- x', 'SELECT 1 /* keep */']))->toBe(['SELECT 1 /* keep */']);
    expect(rfRun(DriverName::Postgres, TransferMethod::Builtin, array_map('rfSql', ['BEGIN /* c */', 'COMMIT -- trailing', 'COMMIT /* a */ -- b'])))->toBe([]);
});

it('removes PostgreSQL ABORT', function () {
    expect(rfRun(DriverName::Postgres, TransferMethod::Builtin, array_map('rfSql', ['ABORT', 'ABORT WORK', 'abort transaction'])))->toBe([]);
});

it('sees through the MariaDB sandbox marker line in front of a database statement', function () {
    $mark = "/*M!999999\- enable the sandbox mode */\n";
    expect(rfMy([$mark.'CREATE DATABASE /*!32312 IF NOT EXISTS*/ `shop` /*!40100 DEFAULT CHARACTER SET utf8mb4 */'], driver: DriverName::MariaDb))->toBe([]);
    expect(rfMy([$mark.'USE `shop`', $mark.'DROP DATABASE IF EXISTS `shop`'], driver: DriverName::MariaDb))->toBe([]);
    expect(fn () => rfMy([$mark.'USE `a`', 'USE `b`'], driver: DriverName::MariaDb))->toThrow(RestoreRefused::class, '(a and b)');
    $keep = [$mark.'SET @x = 1', $mark.'CREATE TABLE t (id int)'];
    expect(rfMy($keep, driver: DriverName::MariaDb))->toBe($keep);
});

it('parses postgres URIs in \connect', function () {
    expect(rfPg([rfMeta('\connect postgresql://h/a'), rfMeta('\connect a'), rfMeta('\c postgres://u@h:5432/a?sslmode=require'), rfMeta('\c postgresql://h?dbname=a')], TransferMethod::Native))->toBe([]);
    expect(fn () => rfPg([rfMeta('\connect postgresql://h/a'), rfMeta('\connect b')], TransferMethod::Native))->toThrow(RestoreRefused::class, '(a and b)');
});
