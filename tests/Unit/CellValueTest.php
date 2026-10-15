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
    'binary' => ["\xff\xfe\x00\x01", '[binary 4 bytes]'],
]);

it('reads stream resources', function () {
    $stream = fopen('php://memory', 'r+');
    fwrite($stream, 'abc');
    rewind($stream);

    expect(CellValue::present($stream))->toBe('abc');
});
