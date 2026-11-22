<?php

use App\Transfers\Export\MySqlBuiltinExporter;

it('fails instead of skipping a listed table whose columns it could not read', function () {
    $columns = ['users' => [['name' => 'id', 'kind' => 'plain']], 'empty' => []];

    expect(MySqlBuiltinExporter::columnsOf($columns, 'users'))->toBe([['name' => 'id', 'kind' => 'plain']])
        ->and(fn () => MySqlBuiltinExporter::columnsOf($columns, 'orders'))
        ->toThrow(RuntimeException::class, "Couldn't read the columns of table orders")
        ->and(fn () => MySqlBuiltinExporter::columnsOf($columns, 'empty'))
        ->toThrow(RuntimeException::class, "Couldn't read the columns of table empty");
});
