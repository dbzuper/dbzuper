<?php

use App\Transfers\Export\ExportOptions;

function modeOptions(array $extra = []): ExportOptions
{
    return ExportOptions::fromRequest($extra + ['tables' => ['a', 'b'], 'structure' => true, 'data' => true, 'drop' => false, 'gzip' => false]);
}

it('collapses equal modes to the global flags', function () {
    $o = modeOptions(['table_modes' => ['a' => 'structure', 'b' => 'structure']]);

    expect($o->structure)->toBeTrue()
        ->and($o->data)->toBeFalse()
        ->and($o->modes)->toBe([])
        ->and($o->isMixed())->toBeFalse();
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
        ->and($o->modeKinds())->toBe(['structure']);
});
