<?php

use App\Database\Sql\SqlSplitter;

$cases = json_decode(file_get_contents(dirname(__DIR__, 2).'/fixtures/sql/split-cases.json'), true);

it('splits statements', function (string $dialect, string $sql, array $statements) {
    expect(array_column(SqlSplitter::split($sql, $dialect), 'sql'))->toBe($statements);
})->with(array_map(fn ($c) => [$c['dialect'], $c['sql'], $c['statements']], array_combine(array_column($cases, 'name'), $cases)));

it('reports byte offsets that slice back to the statement', function () {
    $sql = "select 'é';\n  select 2 ;";
    foreach (SqlSplitter::split($sql, 'sqlite') as $part) {
        expect(substr($sql, $part['start'], $part['end'] - $part['start']))->toBe($part['sql']);
    }
});
