<?php

use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Models\SavedConnection;
use App\Models\Transfer;
use Illuminate\Support\Facades\DB;

function makeTransfer(SavedConnection $connection, array $attributes = []): Transfer
{
    return Transfer::create([
        'user_id' => $connection->user_id,
        'saved_connection_id' => $connection->id,
        'database' => '',
        'direction' => TransferDirection::Export,
        'method' => TransferMethod::Builtin,
        'options' => [],
        'status' => TransferStatus::Pending,
        'file_name' => 'dump.sql',
        ...$attributes,
    ]);
}

it('scopes the run connection to the transfer database', function () {
    $server = SavedConnection::factory()->create(['database' => '']);
    $scoped = makeTransfer($server, ['database' => 'shop']);
    expect($scoped->runConnection()->scopedDatabase())->toBe('shop');

    $fixed = SavedConnection::factory()->create(['database' => 'app']);
    $plain = makeTransfer($fixed);
    expect($plain->runConnection()->scopedDatabase())->toBeNull();
});

it('never exposes the file path', function () {
    $t = makeTransfer(SavedConnection::factory()->create(), ['file_path' => '/secret/dump.sql', 'warnings' => ['a']]);

    $api = $t->toApiArray();
    expect(array_key_exists('file_path', $api))->toBeFalse()
        ->and($api['warnings'])->toBe(['a'])
        ->and($api['downloadable'])->toBeFalse()
        ->and($api['status'])->toBe('pending');
});

it('sees a cancel request made by another process', function () {
    $t = makeTransfer(SavedConnection::factory()->create());
    expect($t->cancelRequested())->toBeFalse();

    DB::table('transfers')->where('id', $t->id)->update(['cancel_requested_at' => now()]);

    expect($t->cancelRequested())->toBeTrue();
});

it('classifies statuses', function () {
    expect(TransferStatus::Uploading->isActive())->toBeTrue()
        ->and(TransferStatus::Running->isActive())->toBeTrue()
        ->and(TransferStatus::Done->isActive())->toBeFalse()
        ->and(TransferStatus::Done->isFinished())->toBeTrue()
        ->and(TransferStatus::Cancelled->isFinished())->toBeTrue()
        ->and(TransferStatus::Pending->isFinished())->toBeFalse();
});

it('counts a transfer whose row is gone as cancelled', function () {
    $t = makeTransfer(SavedConnection::factory()->create());
    Transfer::query()->whereKey($t->id)->delete();

    expect($t->cancelRequested())->toBeTrue();
});
