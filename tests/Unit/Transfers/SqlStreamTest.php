<?php

use App\Database\Sql\SqlLexer;
use App\Transfers\Import\SqlPiece;
use App\Transfers\Import\SqlStream;
use App\Transfers\Io\DumpReader;

/** Writes $sql to a temp file and returns every piece SqlStream yields for it. */
function sqlStreamPieces(string $sql, string $dialect, int $chunk = 7): array
{
    $path = sys_get_temp_dir().DIRECTORY_SEPARATOR.'sqlstream-'.uniqid('', true).'.sql';
    file_put_contents($path, $sql);

    try {
        return iterator_to_array(SqlStream::pieces(new DumpReader($path), $dialect, $chunk), false);
    } finally {
        @unlink($path);
    }
}

/** @return list<array{string, string}> [kind, text] pairs */
function sqlStreamShape(array $pieces): array
{
    return array_map(fn (SqlPiece $p) => [$p->kind, $p->text], $pieces);
}

/**
 * Reference split built on SqlLexer: SqlSplitter's rules, plus the stream's documented differences
 * (leading comments dropped, trailing whitespace trimmed, MySQL executable comments significant).
 *
 * @return list<string>
 */
function sqlStreamOracle(string $sql, string $dialect): array
{
    $mysql = $dialect === 'mysql' || $dialect === 'mariadb';
    $exec = fn ($t) => $mysql && $t->type === 'comment'
        && (str_starts_with($t->value, '/*!') || ($dialect === 'mariadb' && str_starts_with($t->value, '/*M!')));
    $out = [];
    $group = [];
    foreach ([...SqlLexer::tokenize($sql, $dialect), null] as $token) {
        if ($token !== null && $token->type !== 'semicolon') {
            $group[] = $token;

            continue;
        }
        while ($group !== [] && $group[0]->type === 'comment' && ! $exec($group[0])) {
            array_shift($group);
        }
        if ($group !== []) {
            $last = $group[count($group) - 1];
            $out[] = rtrim(substr($sql, $group[0]->start, $last->end - $group[0]->start), " \t\n\r\f\x0B");
        }
        $group = [];
    }

    return $out;
}

$cases = json_decode(file_get_contents(dirname(__DIR__, 2).'/fixtures/sql/split-cases.json'), true);

it('yields the same statements as SqlSplitter for every split-cases fixture', function (string $dialect, string $sql, array $statements) {
    $pieces = sqlStreamPieces($sql, $dialect, 7);

    expect(array_map(fn (SqlPiece $p) => $p->kind, $pieces))->each->toBe('sql')
        ->and(array_map(fn (SqlPiece $p) => $p->text, $pieces))->toBe($statements)
        ->and(array_map(fn (SqlPiece $p) => $p->number, $pieces))->toBe($statements === [] ? [] : range(1, count($statements)));
})->with(array_map(fn ($c) => [$c['dialect'], $c['sql'], $c['statements']], array_combine(array_column($cases, 'name'), $cases)));

it('matches the lexer-based reference split on random input at any chunk size', function (string $dialect) {
    mt_srand(crc32($dialect));
    $fragments = ['select', ' ', "\n", "\r\n", "\r", "\t", ';', ';', ';', '1', '1.5', 'x', "'a;b'", "'it''s'", "'\\\\'",
        "'\\';'", '"q;"', '`b;t`', "-- c;\n", '--', '-', '--x', '/* c; */', '/*', '*/', '/', '*', "'", '"', '`',
        'x$', '$', '$$', '$t$', 'E', "E'\\';'", 'e', '#', "# h;\n", '[', ']', 'é', '/*!1 ;*/', '/*M!1 ;*/',
        '/*!', '/* a /* b; */ c */'];
    $path = sys_get_temp_dir().DIRECTORY_SEPARATOR.'sqlstream-fuzz-'.uniqid('', true).'.sql';
    $checked = 0;
    for ($case = 0; $case < 250; $case++) {
        $sql = '';
        for ($n = mt_rand(1, 30); $n > 0; $n--) {
            $sql .= $fragments[mt_rand(0, count($fragments) - 1)];
        }
        $expected = sqlStreamOracle($sql, $dialect);
        if ($dialect === 'pgsql' && array_filter($expected, fn ($s) => str_starts_with($s, '\\')) !== []) {
            continue; // a psql meta line by construction, covered elsewhere
        }
        file_put_contents($path, $sql);
        foreach ([1, 2, 3, 64] as $chunk) {
            $got = iterator_to_array(SqlStream::pieces(new DumpReader($path), $dialect, $chunk), false);
            expect(array_map(fn (SqlPiece $p) => $p->text, $got))->toBe($expected, json_encode(['sql' => $sql, 'chunk' => $chunk]));
        }
        $checked++;
    }
    @unlink($path);
    expect($checked)->toBeGreaterThan(200);
})->with(['mysql', 'mariadb', 'pgsql', 'sqlite']);

it('keeps a statement larger than the chunk whole', function () {
    $insert = 'INSERT INTO t VALUES '.implode(',', array_map(fn ($i) => "($i,'v;$i')", range(1, 200_000)));
    $insert = substr($insert, 0, 3 * 1024 * 1024 - 20);
    $insert = substr($insert, 0, strrpos($insert, ',')); // keep it well formed
    expect(strlen($insert))->toBeGreaterThan(3_000_000);

    $pieces = sqlStreamPieces($insert.";\nSELECT 1;", 'mysql', 64 * 1024);

    expect($pieces)->toHaveCount(2)
        ->and($pieces[0]->text)->toBe($insert)
        ->and($pieces[1]->text)->toBe('SELECT 1');
});

it('splits a 20 MB statement read in 64 KB chunks quickly with bounded memory', function () {
    $path = sys_get_temp_dir().DIRECTORY_SEPARATOR.'sqlstream-big-'.uniqid('', true).'.sql';
    $handle = fopen($path, 'wb');
    fwrite($handle, "SELECT 0;\nINSERT INTO t VALUES (0,'start')");
    $row = ",(1,'abc;def',2.5,NULL,'it''s'),(\"x\",`y`,3)";
    $size = 0;
    while ($size < 20_000_000) {
        $size += fwrite($handle, str_repeat($row, 1000));
    }
    fwrite($handle, ";\nSELECT 2;\n");
    fclose($handle);
    $statementBytes = filesize($path) - strlen("SELECT 0;\n;\nSELECT 2;\n");

    try {
        gc_collect_cycles();
        memory_reset_peak_usage();
        $before = memory_get_usage();
        $started = microtime(true);
        $lengths = [];
        foreach (SqlStream::pieces(new DumpReader($path), 'mysql', 64 * 1024) as $piece) {
            $lengths[] = strlen($piece->text);
        }
        $seconds = microtime(true) - $started;
        $growth = memory_get_peak_usage() - $before;
    } finally {
        @unlink($path);
    }

    expect($lengths)->toBe([8, $statementBytes, 8])
        ->and($seconds)->toBeLessThan(5.0)
        ->and($growth)->toBeLessThan(5 * $statementBytes);
});

it('handles DELIMITER blocks', function () {
    $sql = "DELIMITER ;;\nCREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.x=1; END;;\nDELIMITER ;\nSELECT 1;";

    $pieces = sqlStreamPieces($sql, 'mysql', 7);

    expect(sqlStreamShape($pieces))->toBe([
        ['delimiter', ';;'],
        ['sql', 'CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.x=1; END'],
        ['delimiter', ';'],
        ['sql', 'SELECT 1'],
    ])
        ->and($pieces[1]->delimiter)->toBe(';;')
        ->and($pieces[1]->number)->toBe(1)
        ->and($pieces[3]->delimiter)->toBe(';')
        ->and($pieces[3]->number)->toBe(2);
});

it('ignores a custom delimiter inside strings, identifiers and comments', function () {
    $sql = "delimiter \$\$\nSELECT '\$\$', `a\$\$b` /* \$\$ */ -- \$\$\n, 2\$\$\nSELECT 3\$\$";

    expect(sqlStreamShape(sqlStreamPieces($sql, 'mariadb', 3)))->toBe([
        ['delimiter', '$$'],
        ['sql', "SELECT '\$\$', `a\$\$b` /* \$\$ */ -- \$\$\n, 2"],
        ['sql', 'SELECT 3'],
    ]);
});

it('treats DELIMITER as plain text outside MySQL and inside a statement', function () {
    expect(sqlStreamShape(sqlStreamPieces("DELIMITER //\nSELECT 1;", 'pgsql')))
        ->toBe([['sql', "DELIMITER //\nSELECT 1"]])
        ->and(sqlStreamShape(sqlStreamPieces("SELECT 1\nDELIMITER //\n;", 'mysql')))
        ->toBe([['sql', "SELECT 1\nDELIMITER //"]]);
});

it('keeps executable comments', function (string $dialect) {
    $sql = "/*!40014 SET FOREIGN_KEY_CHECKS=0 */;\n/* plain */;\n/*!40101 SET NAMES utf8mb4 */;\n";

    expect(sqlStreamShape(sqlStreamPieces($sql, $dialect, 5)))->toBe([
        ['sql', '/*!40014 SET FOREIGN_KEY_CHECKS=0 */'],
        ['sql', '/*!40101 SET NAMES utf8mb4 */'],
    ]);
})->with(['mysql', 'mariadb']);

it('keeps MariaDB /*M! comments only on MariaDB', function () {
    $sql = "/*M!100616 SET NOTE_VERBOSITY=0 */;\nSELECT 1;";

    expect(sqlStreamShape(sqlStreamPieces($sql, 'mariadb')))->toBe([['sql', '/*M!100616 SET NOTE_VERBOSITY=0 */'], ['sql', 'SELECT 1']])
        ->and(sqlStreamShape(sqlStreamPieces($sql, 'mysql')))->toBe([['sql', 'SELECT 1']]);
});

it('drops leading comments and empty statements', function () {
    $sql = "-- header\n--\n/* block */\n;\n-- Name: t; Type: TABLE\nCREATE TABLE t (a int);\n-- trailing\n";

    expect(sqlStreamShape(sqlStreamPieces($sql, 'pgsql', 4)))->toBe([['sql', 'CREATE TABLE t (a int)']]);
});

it('emits psql meta lines and copy data', function () {
    $sql = "\\restrict abc\nCOPY t (a) FROM stdin;\n1\n2\n\\.\nSELECT 1;";

    $pieces = sqlStreamPieces($sql, 'pgsql', 7);

    expect(sqlStreamShape($pieces))->toBe([
        ['meta', '\\restrict abc'],
        ['sql', 'COPY t (a) FROM stdin'],
        ['copy_data', "1\n2\n\\.\n"],
        ['sql', 'SELECT 1'],
    ])
        ->and(array_map(fn (SqlPiece $p) => $p->number, $pieces))->toBe([0, 1, 0, 2]);
});

it('finds psql meta lines after pg_dump header comments', function () {
    $sql = "--\n-- PostgreSQL database dump\n--\n\n\\restrict K3y\n\nSET statement_timeout = 0;\n\\unrestrict K3y\n";

    expect(sqlStreamShape(sqlStreamPieces($sql, 'pgsql', 3)))->toBe([
        ['meta', '\\restrict K3y'],
        ['sql', 'SET statement_timeout = 0'],
        ['meta', '\\unrestrict K3y'],
    ]);
});

it('keeps COPY data lines that only look like terminators', function () {
    $sql = "COPY t (a) FROM stdin;\na\\.\n\\.x\n\\\\.\n\\.\nCOPY u FROM STDIN WITH (FORMAT text);\n\\.\n";

    expect(sqlStreamShape(sqlStreamPieces($sql, 'pgsql', 2)))->toBe([
        ['sql', 'COPY t (a) FROM stdin'],
        ['copy_data', "a\\.\n\\.x\n\\\\.\n\\.\n"],
        ['sql', 'COPY u FROM STDIN WITH (FORMAT text)'],
        ['copy_data', "\\.\n"],
    ]);
});

it('accepts a COPY terminator at end of file without a newline', function () {
    expect(sqlStreamShape(sqlStreamPieces("COPY t FROM stdin;\n1\n\\.", 'pgsql', 3)))
        ->toBe([['sql', 'COPY t FROM stdin'], ['copy_data', "1\n\\.\n"]]);
});

it('fails on COPY data without a terminator', function () {
    sqlStreamPieces("COPY t FROM stdin;\n1\n2\n", 'pgsql');
})->throws(RuntimeException::class, 'Unterminated COPY data');

it('does not start COPY data for COPY TO stdout', function () {
    expect(sqlStreamShape(sqlStreamPieces("COPY t TO stdout;\nSELECT 1;", 'pgsql')))
        ->toBe([['sql', 'COPY t TO stdout'], ['sql', 'SELECT 1']]);
});

it('accepts CRLF and a BOM', function () {
    $mysql = "\xEF\xBB\xBF/*!40014 SET FOREIGN_KEY_CHECKS=0 */;\r\nDELIMITER ;;\r\nCREATE PROCEDURE p() BEGIN SELECT 1; END;;\r\nDELIMITER ;\r\nSELECT 2;\r\n";
    $pg = "\xEF\xBB\xBF-- dump\r\n\\connect db\r\nCOPY t (a) FROM stdin;\r\n1\r\n2\r\n\\.\r\nSELECT 3;\r\n";

    expect(sqlStreamShape(sqlStreamPieces($mysql, 'mysql', 5)))->toBe([
        ['sql', '/*!40014 SET FOREIGN_KEY_CHECKS=0 */'],
        ['delimiter', ';;'],
        ['sql', 'CREATE PROCEDURE p() BEGIN SELECT 1; END'],
        ['delimiter', ';'],
        ['sql', 'SELECT 2'],
    ])->and(sqlStreamShape(sqlStreamPieces($pg, 'pgsql', 5)))->toBe([
        ['meta', '\\connect db'],
        ['sql', 'COPY t (a) FROM stdin'],
        ['copy_data', "1\n2\n\\.\n"],
        ['sql', 'SELECT 3'],
    ]);
});

it('does not treat a backslash inside a string as meta', function () {
    $sql = "SELECT 'a;\n\\b';\nSELECT \$\$x\n\\c;\$\$;\nSELECT E'\\';\n\\d';\n";

    expect(sqlStreamShape(sqlStreamPieces($sql, 'pgsql', 3)))->toBe([
        ['sql', "SELECT 'a;\n\\b'"],
        ['sql', "SELECT \$\$x\n\\c;\$\$"],
        ['sql', "SELECT E'\\';\n\\d'"],
    ]);
});

it('yields nothing for an empty or comment-only file', function (string $sql) {
    expect(sqlStreamPieces($sql, 'mysql'))->toBe([]);
})->with(['empty' => '', 'bom only' => "\xEF\xBB\xBF", 'comments' => "-- a\n# b\n/* c */ ;\n"]);
