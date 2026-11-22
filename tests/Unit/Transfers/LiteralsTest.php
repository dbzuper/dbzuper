<?php

use App\Transfers\Export\Literals;

it('writes MySQL literals', function (mixed $value, bool $binary, string $expected) {
    expect(Literals::mysql($value, $binary))->toBe($expected);
})->with([
    'null' => [null, false, 'NULL'],
    'zero' => [0, false, '0'],
    'float' => [-1.5, false, '-1.5'],
    'quote' => ["it's", false, "'it\\'s'"],
    'double quote' => ['say "hi"', false, "'say \\\"hi\\\"'"],
    'backslash' => ['back\\slash', false, "'back\\\\slash'"],
    'newline' => ["line\nbreak", false, "'line\\nbreak'"],
    'carriage return' => ["a\rb", false, "'a\\rb'"],
    'nul' => ["\0", false, "'\\0'"],
    'ctrl-z' => ["\x1a", false, "'\\Z'"],
    'unicode' => ['zoë 😀', false, "'zoë 😀'"],
    'numeric string stays quoted' => ['12', false, "'12'"],
    'binary' => ["\x00\xff", true, '0x00ff'],
    'empty binary' => ['', true, "''"],
    'bool' => [true, false, '1'],
    'false' => [false, false, '0'],
    'float 0.1' => [0.1, false, '0.1'],
    'float 1e100' => [1e100, false, '1.0E+100'],
    'float -0.0' => [-0.0, false, '-0.0'],
]);

it('writes PostgreSQL literals', function (mixed $value, bool $bytea, string $expected) {
    expect(Literals::postgres($value, $bytea))->toBe($expected);
})->with([
    'null' => [null, false, 'NULL'],
    'zero' => [0, false, '0'],
    'float' => [-1.5, false, '-1.5'],
    'quote' => ["it's", false, "'it''s'"],
    'backslash' => ['back\\slash', false, "'back\\slash'"],
    'newline' => ["line\nbreak", false, "'line\nbreak'"],
    // psql on Windows reads stdin in text mode and turns a raw CRLF into LF, so CR is written as an escape.
    'carriage return' => ["a\r\nb\\c'd", false, "E'a\\r\nb\\\\c''d'"],
    'unicode' => ['zoë 😀', false, "'zoë 😀'"],
    'numeric string stays quoted' => ['12', false, "'12'"],
    'nan' => [NAN, false, "'NaN'"],
    'inf' => [INF, false, "'Infinity'"],
    '-inf' => [-INF, false, "'-Infinity'"],
    'true' => [true, false, 'true'],
    'false' => [false, false, 'false'],
    'binary' => ["\x00\xff", true, "'\\x00ff'::bytea"],
    'empty binary' => ['', true, "'\\x'::bytea"],
    'float 0.1' => [0.1, false, '0.1'],
    'float 1e100' => [1e100, false, '1.0E+100'],
    'float -0.0' => [-0.0, false, '-0.0'],
]);

it('writes SQLite literals', function (mixed $value, bool $blob, string $expected) {
    expect(Literals::sqlite($value, $blob))->toBe($expected);
})->with([
    'null' => [null, false, 'NULL'],
    'zero' => [0, false, '0'],
    'float' => [-1.5, false, '-1.5'],
    'quote' => ["it's", false, "'it''s'"],
    'backslash' => ['back\\slash', false, "'back\\slash'"],
    'newline' => ["line\nbreak", false, "'line\nbreak'"],
    'unicode' => ['zoë 😀', false, "'zoë 😀'"],
    'binary' => ["\x00\xff", true, "X'00ff'"],
    'empty binary' => ['', true, "X''"],
    'bool' => [false, false, '0'],
    'nul text' => ["a\0b", false, "CAST(X'610062' AS TEXT)"],
    'float 0.1' => [0.1, false, '0.1'],
    'float 1e100' => [1e100, false, '1.0E+100'],
    'float -0.0' => [-0.0, false, '-0.0'],
]);

it('rejects values it cannot write', function () {
    expect(fn () => Literals::mysql(NAN, false))->toThrow(InvalidArgumentException::class, 'MySQL cannot store NaN or Infinity')
        ->and(fn () => Literals::mysql(INF, false))->toThrow(InvalidArgumentException::class)
        ->and(fn () => Literals::postgres([1], false))->toThrow(InvalidArgumentException::class)
        ->and(fn () => Literals::sqlite(new stdClass, false))->toThrow(InvalidArgumentException::class);
});

it('reads stream resources such as PDO bytea', function () {
    $stream = fn () => tap(fopen('php://memory', 'r+'), function ($h) {
        fwrite($h, "\x00\xff");
        rewind($h);
    });

    expect(Literals::postgres($stream(), true))->toBe("'\\x00ff'::bytea")
        ->and(Literals::mysql($stream(), true))->toBe('0x00ff')
        ->and(Literals::sqlite($stream(), true))->toBe("X'00ff'");
});

it('round-trips SQLite text containing NUL', function () {
    $pdo = new PDO('sqlite::memory:');
    $value = "a\0b";
    $literal = Literals::sqlite($value, false);
    $got = $pdo->query("SELECT {$literal} AS v")->fetch(PDO::FETCH_ASSOC);

    expect($got['v'])->toBe($value);
});
