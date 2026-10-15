<?php

use App\Database\Records\RecordKey;

it('rejects a value count that does not match the primary key', function () {
    RecordKey::fromValues(['primary_key' => ['a', 'b']], [1]);
})->throws(InvalidArgumentException::class, 'Expected 2 key values, got 1');
