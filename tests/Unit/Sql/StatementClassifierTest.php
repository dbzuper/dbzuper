<?php

use App\Database\Sql\StatementClassifier;

$cases = json_decode(file_get_contents(dirname(__DIR__, 2).'/fixtures/sql/classify-cases.json'), true);

it('classifies statements', function (string $dialect, string $sql, string $kind, ?string $target) {
    $c = StatementClassifier::classify($sql, $dialect);
    expect($c->kind)->toBe($kind)->and($c->target)->toBe($target);
})->with(array_map(fn ($c) => [$c['dialect'], $c['sql'], $c['kind'], $c['target'] ?? null], array_combine(array_map(fn ($c) => $c['dialect'].': '.$c['sql'], $cases), $cases)));

it('exposes the leading keyword', function () {
    expect(StatementClassifier::classify('  Update t set a=1', 'sqlite')->keyword)->toBe('UPDATE');
});
