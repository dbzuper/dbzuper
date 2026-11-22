<?php

use App\Transfers\Io\DumpReader;
use App\Transfers\Io\DumpWriter;

function dumpIoPath(string $name): string
{
    return sys_get_temp_dir().DIRECTORY_SEPARATOR.'dumpio-'.uniqid().'-'.$name;
}

function dumpIoText(int $bytes): string
{
    $out = '';
    $i = 0;
    while (strlen($out) < $bytes) {
        $out .= "INSERT INTO t VALUES ($i, '".md5((string) $i)."', 'caf\u{e9} \u{1F600}');\n";
        $i++;
    }

    return substr($out, 0, $bytes);
}

function dumpIoReadAll(DumpReader $reader): string
{
    $all = '';
    while (($chunk = $reader->read(1_000_000)) !== null) {
        expect($chunk)->not->toBe('');
        $all .= $chunk;
    }

    return $all;
}

it('round-trips plain and gzip text larger than one chunk', function (bool $gzip) {
    $path = dumpIoPath($gzip ? 'a.sql.gz' : 'a.sql');
    $text = dumpIoText(5 * 1024 * 1024);

    $writer = new DumpWriter($path, $gzip);
    foreach (str_split($text, 70_000) as $part) {
        $writer->write($part);
    }
    expect($writer->bytesWritten())->toBe(strlen($text));
    $size = $writer->close();
    expect($size)->toBe(filesize($path));

    $reader = new DumpReader($path);
    expect($reader->isGzip())->toBe($gzip);
    expect(dumpIoReadAll($reader))->toBe($text);
    unlink($path);
})->with([false, true]);

it('detects gzip by content not name', function () {
    $path = dumpIoPath('named.sql');
    $writer = new DumpWriter($path, true);
    $writer->write('SELECT 1;');
    $writer->close();

    $reader = new DumpReader($path);
    expect($reader->isGzip())->toBeTrue();
    expect(dumpIoReadAll($reader))->toBe('SELECT 1;');
    unlink($path);
});

it('strips a UTF-8 BOM', function () {
    $path = dumpIoPath('bom.sql');
    file_put_contents($path, "\xEF\xBB\xBFSELECT 1;");

    expect(dumpIoReadAll(new DumpReader($path)))->toBe('SELECT 1;');
    unlink($path);
});

it('abort removes the file', function () {
    $path = dumpIoPath('abort.sql');
    $writer = new DumpWriter($path, false);
    $writer->write('partial');
    $writer->abort();

    expect(file_exists($path))->toBeFalse();
});

it('reports position in file bytes', function () {
    $path = dumpIoPath('pos.sql.gz');
    $writer = new DumpWriter($path, true);
    $writer->write(dumpIoText(3 * 1024 * 1024));
    $writer->close();

    $reader = new DumpReader($path);
    expect($reader->position())->toBe(0);
    dumpIoReadAll($reader);
    expect($reader->position())->toBe(filesize($path));
    unlink($path);
});

it('throws on a missing file and on a corrupt gzip stream', function () {
    expect(fn () => new DumpReader(dumpIoPath('missing.sql')))->toThrow(RuntimeException::class);

    $path = dumpIoPath('bad.gz');
    file_put_contents($path, "\x1f\x8b".str_repeat("\xff", 100));
    $reader = new DumpReader($path);
    expect(fn () => $reader->read())->toThrow(RuntimeException::class);
    unlink($path);
});

it('reads every member of a multi-member gzip file', function () {
    $path = dumpIoPath('multi.sql.gz');
    $big = dumpIoText(300_000);
    file_put_contents($path, gzencode("AAA\n").gzencode($big).gzencode("BBB\n"));

    $reader = new DumpReader($path);
    expect(dumpIoReadAll($reader))->toBe("AAA\n".$big."BBB\n");
    expect($reader->position())->toBe(filesize($path));
    unlink($path);
});

it('ignores trailing NUL padding after a gzip member', function () {
    $path = dumpIoPath('pad.sql.gz');
    file_put_contents($path, gzencode("AAA\n").gzencode("BBB\n").str_repeat("\0", 20_000));

    expect(dumpIoReadAll(new DumpReader($path)))->toBe("AAA\nBBB\n");
    unlink($path);
});
