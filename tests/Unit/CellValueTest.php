<?php

use App\Database\CellValue;

it('presents values safely for JSON', function (mixed $in, mixed $out) {
    expect(CellValue::present($in))->toBe($out);
})->with([
    'null' => [null, null],
    'int' => [42, 42],
    'float' => [1.5, 1.5],
    'bool' => [true, true],
    'short string' => ['hello', 'hello'],
    'long string' => [str_repeat('a', 250), str_repeat('a', 200).'…'],
    'multibyte' => [str_repeat('é', 201), str_repeat('é', 200).'…'],
    'nan' => [NAN, 'NaN'],
    'inf' => [INF, 'Infinity'],
    '-inf' => [-INF, '-Infinity'],
    'max safe int' => [9007199254740991, 9007199254740991],
    'min safe int' => [-9007199254740991, -9007199254740991],
    'unsafe int' => [9007199254740992, '9007199254740992'],
    'unsafe negative int' => [-9007199254740992, '-9007199254740992'],
    'php int max' => [PHP_INT_MAX, '9223372036854775807'],
    'php int min' => [PHP_INT_MIN, (string) PHP_INT_MIN],
    'binary' => ["\xff\xfe\x00\x01", '[binary 4 bytes]'],
]);

it('reads stream resources', function () {
    $stream = fopen('php://memory', 'r+');
    fwrite($stream, 'abc');
    rewind($stream);

    expect(CellValue::present($stream))->toBe('abc');
});

it('accepts a custom character cap', function () {
    expect(CellValue::present(str_repeat('é', 5000), CellValue::RESULT_CHARS))->toBe(str_repeat('é', 4000).'…');
});
