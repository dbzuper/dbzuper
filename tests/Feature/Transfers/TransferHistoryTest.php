<?php

use App\Database\Query\HistoryRecorder;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Models\SavedConnection;
use App\Models\Transfer;

function historyTransfer(SavedConnection $c, array $attributes): Transfer
{
    return Transfer::create([
        'user_id' => $c->user_id, 'saved_connection_id' => $c->id, 'database' => '',
        'direction' => TransferDirection::Export, 'method' => TransferMethod::Native, 'options' => [],
        'status' => TransferStatus::Done, 'file_name' => 'x.sql',
        'started_at' => now()->subSeconds(3), 'finished_at' => now(),
        ...$attributes,
    ]);
}

it('formats sizes for humans', function (int $bytes, string $text) {
    expect(HistoryRecorder::bytesForHumans($bytes))->toBe($text);
})->with([
    [0, '0 B'], [512, '512 B'], [1024, '1 KB'], [1536, '1.5 KB'], [1_932_735_283, '1.8 GB'], [5 * 1024 ** 4, '5 TB'],
]);

it('records a backup as one comment line', function () {
    $c = SavedConnection::factory()->create();
    $t = historyTransfer($c, ['options' => ['table_count' => 214], 'file_size' => 1_932_735_283]);

    app(HistoryRecorder::class)->recordTransfer($c, $t);

    $entry = $c->history()->sole();
    expect($entry->sql)->toBe('-- Backup: 214 tables, 1.8 GB, native')
        ->and($entry->kind)->toBe('transfer')
        ->and($entry->status)->toBe('ok')
        ->and($entry->duration_ms)->toBeGreaterThanOrEqual(3000)
        ->and($entry->error)->toBeNull();
});

it('records a restore and a failure', function () {
    $c = SavedConnection::factory()->create();
    $t = historyTransfer($c, [
        'direction' => TransferDirection::Import, 'method' => TransferMethod::Builtin,
        'file_name' => 'shop_prod-20261122.sql.gz', 'statements_done' => 12_340,
        'status' => TransferStatus::Failed, 'error' => 'Duplicate entry',
    ]);

    app(HistoryRecorder::class)->recordTransfer($c, $t);

    $entry = $c->history()->sole();
    expect($entry->sql)->toBe('-- Restore: shop_prod-20261122.sql.gz, 12,340 statements, built-in')
        ->and($entry->status)->toBe('error')
        ->and($entry->error)->toBe('Duplicate entry');
});

it('respects store_history', function () {
    $c = SavedConnection::factory()->create(['store_history' => false]);

    app(HistoryRecorder::class)->recordTransfer($c, historyTransfer($c, []));

    expect($c->history()->count())->toBe(0);
});

it('keeps the history line on one line', function () {
    $c = SavedConnection::factory()->create();
    $t = historyTransfer($c, ['direction' => TransferDirection::Import, 'file_name' => "a\r\nb.sql", 'statements_done' => 1]);

    app(HistoryRecorder::class)->recordTransfer($c, $t);

    expect($c->history()->sole()->sql)->toBe('-- Restore: a  b.sql, 1 statement, native');
});
