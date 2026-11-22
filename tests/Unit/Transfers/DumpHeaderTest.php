<?php

use App\Transfers\Export\DumpHeader;

function headerMeta(array $over = []): array
{
    return array_merge([
        'app_version' => '1.2.3',
        'engine' => 'mysql',
        'server_version' => '8.0',
        'database' => 'shop',
        'date' => '2026-11-22 10:00:00',
        'method' => 'builtin',
        'options' => 'structure+data',
        'gaps' => [],
    ], $over);
}

it('lists gaps', function () {
    $out = DumpHeader::render(headerMeta(['gaps' => ['views', 'triggers']]));

    expect($out)->toContain("-- Not included: views, triggers\n")
        ->and($out)->toContain("-- Engine: mysql\n");
});

it('omits the gaps line when there are none', function () {
    expect(DumpHeader::render(headerMeta()))->not->toContain('Not included');
});

it('keeps every line a comment even with newlines in values', function () {
    $out = DumpHeader::render(headerMeta(['database' => "a\r\nDROP DATABASE x;", 'schemas' => ['Sales', "b\nc"]]));

    foreach (explode("\n", rtrim($out, "\n")) as $line) {
        expect($line === '' || str_starts_with($line, '-- '))->toBeTrue();
    }
    expect($out)->toContain('a  DROP DATABASE x;');
});

it('supports another comment prefix', function () {
    expect(DumpHeader::render(headerMeta(), '# '))->toStartWith('# ');
});
