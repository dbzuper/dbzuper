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
    'unicode' => ['zoë 😀', false, "'zoë 😀'"],
    'numeric string stays quoted' => ['12', false, "'12'"],
    'nan' => [NAN, false, "'NaN'"],
    'inf' => [INF, false, "'Infinity'"],
    'true' => [true, false, 'true'],
    'false' => [false, false, 'false'],
    'binary' => ["\x00\xff", true, "'\\x00ff'::bytea"],
    'empty binary' => ['', true, "'\\x'::bytea"],
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
]);
