<?php

use App\Database\Editing\EditMethod;
use App\Database\Editing\EditPlan;

it('restores a cached plan exactly', function () {
    $plan = new EditPlan(EditMethod::UniqueIndex, ['id', 'tenant'], null, ['total'], true, ['payload']);

    expect(EditPlan::fromCached($plan->toArray()))->toEqual($plan);
});

it('restores a plan cached without its optional fields', function () {
    expect(EditPlan::fromCached(['method' => 'none', 'reason' => "views can't be edited"]))
        ->toEqual(EditPlan::none("views can't be edited"));
});

it('ignores cache entries that are not a plan', function (mixed $cached) {
    expect(EditPlan::fromCached($cached))->toBeNull();
})->with([
    'missing' => [null],
    'not an array' => ['primary_key'],
    'no method' => [['key_columns' => ['id']]],
    'unknown method' => [['method' => 'by_magic']],
    'method not a string' => [['method' => 1]],
    'key columns not strings' => [['method' => 'primary_key', 'key_columns' => [['id']]]],
    'key columns not a list' => [['method' => 'primary_key', 'key_columns' => 'id']],
]);
