<?php

use App\Database\DateKind;

it('classifies date and date-time column types', function (string $typeName, ?DateKind $kind) {
    expect(DateKind::classify($typeName))->toBe($kind);
})->with([
    ['date', DateKind::Date],
    ['datetime', DateKind::DateTime],
    ['timestamp', DateKind::DateTime],
    ['timestamptz', DateKind::DateTime],
    ['TIMESTAMP WITHOUT TIME ZONE', DateKind::DateTime],
    ['DATETIME', DateKind::DateTime],
    ['time', null],
    ['varchar', null],
    ['timetz', null],
    ['_timestamp', null],
    ['_timestamptz', null],
    ['_date', null],
    ['timestamp[]', null],
    ['date[]', null],
]);
