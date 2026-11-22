<?php

use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\TransferStorage;
use Illuminate\Support\Facades\File;

afterEach(fn () => File::deleteDirectory(storage_path('app/private/transfers')));

function storedTransfer(array $attributes): Transfer
{
    $connection = SavedConnection::factory()->create();
    $t = Transfer::create([
        'user_id' => $connection->user_id,
        'saved_connection_id' => $connection->id,
        'database' => '',
        'direction' => TransferDirection::Export,
        'method' => TransferMethod::Builtin,
        'options' => [],
        'file_name' => 'dump.sql',
        ...$attributes,
    ]);
    $path = TransferStorage::directory($t).'/dump.sql';
    file_put_contents($path, 'x');
    $t->forceFill(['file_path' => $path])->save();

    return $t;
}

it('creates the directory on demand', function () {
    $t = storedTransfer(['status' => TransferStatus::Done]);

    expect(TransferStorage::directory($t))->toBe(storage_path('app/private/transfers/'.$t->id))
        ->and(is_dir(TransferStorage::directory($t)))->toBeTrue();
});

it('prunes finished exports past expiry and stale uploads', function () {
    $expired = storedTransfer(['status' => TransferStatus::Done, 'finished_at' => now()->subDay(), 'expires_at' => now()->subHour()]);
    $fresh = storedTransfer(['status' => TransferStatus::Done, 'finished_at' => now(), 'expires_at' => now()->addHours(5)]);
    $stale = storedTransfer(['status' => TransferStatus::Uploading, 'direction' => TransferDirection::Import]);
    $stale->forceFill(['updated_at' => now()->subHours(config('dbzuper.transfer_ttl_hours') + 1)])->saveQuietly();
    $running = storedTransfer(['status' => TransferStatus::Running, 'started_at' => now()->subDays(3)]);
    $running->forceFill(['updated_at' => now()->subDays(3)])->saveQuietly();
    $old = storedTransfer(['status' => TransferStatus::Failed, 'finished_at' => now()->subDays(8)]);

    TransferStorage::prune();

    expect(Transfer::find($expired->id))->not->toBeNull()
        ->and(is_dir(storage_path('app/private/transfers/'.$expired->id)))->toBeFalse()
        ->and(Transfer::find($expired->id)->file_path)->toBeNull()
        ->and(is_file($fresh->file_path))->toBeTrue()
        ->and($stale->fresh()->status)->toBe(TransferStatus::Failed)
        ->and($stale->fresh()->error)->toBe('Upload abandoned')
        ->and(is_dir(storage_path('app/private/transfers/'.$stale->id)))->toBeFalse()
        ->and($running->fresh()->status)->toBe(TransferStatus::Running)
        ->and(is_file($running->file_path))->toBeTrue()
        ->and(Transfer::find($old->id))->toBeNull()
        ->and(is_dir(storage_path('app/private/transfers/'.$old->id)))->toBeFalse();
});
