<?php

use App\Enums\DriverName;
use App\Transfers\Export\BuiltinExporter;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Export\InsertBatcher;
use App\Transfers\Io\DumpWriter;
use App\Transfers\TransferProgress;
use Illuminate\Database\Connection;

function batcherRun(int $cap, array $tuples): string
{
    $path = sys_get_temp_dir().DIRECTORY_SEPARATOR.'batcher-'.uniqid().'.sql';
    $w = new DumpWriter($path, false);
    $b = new InsertBatcher($w, 'INSERT INTO "t" VALUES', $cap);
    foreach ($tuples as $t) {
        $b->add($t);
    }
    $b->flush();
    $w->close();
    $out = file_get_contents($path);
    @unlink($path);

    return $out;
}

it('splits at the byte cap', function () {
    $t = "('".str_repeat('a', 36)."')"; // 40 bytes
    expect(strlen($t))->toBe(40);
    $out = batcherRun(100, [$t, $t, $t]);

    expect(substr_count($out, 'INSERT INTO'))->toBe(2)
        ->and(substr_count($out, ";\n"))->toBe(2)
        ->and($out)->toEndWith(";\n");
});

it('writes an oversized tuple on its own', function () {
    $big = "('".str_repeat('x', 248)."')";
    $out = batcherRun(100, [$big]);

    expect(substr_count($out, 'INSERT INTO'))->toBe(1)->and($out)->toContain($big);
});

it('writes an oversized tuple alone between small ones', function () {
    $big = "('".str_repeat('x', 248)."')";
    $out = batcherRun(100, ['(1)', $big, '(2)']);

    expect(substr_count($out, 'INSERT INTO'))->toBe(3);
});

it('writes nothing when no tuples were added', function () {
    expect(batcherRun(100, []))->toBe('');
});

it('resolves a registered exporter and throws for others', function () {
    $fake = new class implements BuiltinExporter
    {
        public function export(Connection $db, ExportOptions $o, DumpWriter $w, TransferProgress $p): void {}

        public function gaps(): array
        {
            return [];
        }
    };
    $registry = new BuiltinExporters(['mysql' => $fake::class, 'mariadb' => $fake::class]);

    expect($registry->for(DriverName::MySql))->toBeInstanceOf(BuiltinExporter::class)
        ->and($registry->for(DriverName::MariaDb))->toBeInstanceOf(BuiltinExporter::class)
        ->and(fn () => $registry->for(DriverName::Postgres))
        ->toThrow(LogicException::class, 'No built-in exporter for pgsql');
});
