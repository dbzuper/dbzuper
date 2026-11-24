<?php

use App\Transfers\Export\ExportOptions;

function modeOptions(array $extra = []): ExportOptions
{
    return ExportOptions::fromRequest($extra + ['tables' => ['a', 'b'], 'structure' => true, 'data' => true, 'drop' => false, 'gzip' => false]);
}

it('collapses modes equal to the globals', function (bool $structure, bool $data, string $mode) {
    $o = modeOptions(['structure' => $structure, 'data' => $data, 'table_modes' => ['a' => $mode, 'b' => $mode]]);

    expect($o->structure)->toBe($structure)
        ->and($o->data)->toBe($data)
        ->and($o->modes)->toBe([])
        ->and($o->isMixed())->toBeFalse()
        ->and($o->modeKinds())->toBe([]);
})->with([
    'both' => [true, true, 'both'],
    'structure' => [true, false, 'structure'],
    'data' => [false, true, 'data'],
]);

it('keeps a partial map that differs from the globals', function () {
    $o = modeOptions(['table_modes' => ['b' => 'structure']]);

    expect($o->isMixed())->toBeTrue()
        ->and($o->structure)->toBeTrue()
        ->and($o->data)->toBeTrue()
        ->and($o->dataFor('a'))->toBeTrue()
        ->and($o->structureFor('a'))->toBeTrue()
        ->and($o->dataFor('b'))->toBeFalse()
        ->and($o->structureFor('b'))->toBeTrue()
        ->and($o->modeKinds())->toBe(['structure']);
});

it('keeps one mode for every table when it differs from the globals', function () {
    $o = modeOptions(['table_modes' => ['a' => 'structure', 'b' => 'structure']]);

    expect($o->isMixed())->toBeTrue()
        ->and($o->dataFor('a'))->toBeFalse()
        ->and($o->dataFor('b'))->toBeFalse();
});

it('takes the mode kinds from the map only, not from keys that use the globals', function () {
    $o = modeOptions(['tables' => ['a', 'b', 'view'], 'structure' => false, 'data' => true, 'table_modes' => ['a' => 'both', 'b' => 'structure']]);

    expect($o->modeKinds())->toEqualCanonicalizing(['both', 'structure'])
        ->and($o->structureFor('view'))->toBeFalse();
});

it('keeps a real mix per table', function () {
    $o = modeOptions(['tables' => ['a', 'b', 'c'], 'table_modes' => ['a' => 'both', 'b' => 'structure', 'c' => 'data']]);

    expect($o->isMixed())->toBeTrue()
        ->and($o->structureFor('c'))->toBeFalse()
        ->and($o->dataFor('b'))->toBeFalse()
        ->and($o->dataFor('a'))->toBeTrue()
        ->and($o->structureFor('b'))->toBeTrue()
        ->and($o->anyStructure())->toBeTrue()
        ->and($o->anyData())->toBeTrue()
        ->and($o->modeKinds())->toEqualCanonicalizing(['both', 'structure', 'data']);
});

it('round-trips through toArray', function () {
    $o = modeOptions(['table_modes' => ['a' => 'both', 'b' => 'data']]);

    expect($o->toArray()['table_modes'])->toBe(['a' => 'both', 'b' => 'data'])
        ->and(ExportOptions::fromRequest($o->toArray()))->toEqual($o);
});

it('behaves as before without table_modes', function () {
    $o = modeOptions(['structure' => true, 'data' => false]);

    expect($o->isMixed())->toBeFalse()
        ->and($o->structureFor('x'))->toBe($o->structure)
        ->and($o->dataFor('x'))->toBe($o->data)
        ->and($o->anyData())->toBeFalse()
        ->and($o->modeKinds())->toBe([]);
});
