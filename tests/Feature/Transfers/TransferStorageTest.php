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
    $stale->forceFill(['updated_at' => now()->subMinutes(config('dbzuper.transfer_upload_idle_minutes') + 1)])->saveQuietly();
    $running = storedTransfer(['status' => TransferStatus::Running, 'started_at' => now()->subDays(3)]);
    $running->forceFill(['updated_at' => now()->subHour()])->saveQuietly();
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

it('fails a running transfer nobody has saved for six hours', function () {
    $t = storedTransfer(['status' => TransferStatus::Running]);
    $t->forceFill(['updated_at' => now()->subHours(7)])->saveQuietly();
    $recent = storedTransfer(['status' => TransferStatus::Running]);

    TransferStorage::prune();

    expect($t->fresh()->status)->toBe(TransferStatus::Failed)
        ->and($t->fresh()->error)->toBe('The background worker stopped while this was running.')
        ->and($t->fresh()->finished_at)->not->toBeNull()
        ->and($recent->fresh()->status)->toBe(TransferStatus::Running);
});

it('fails a running transfer whose worker process is gone from this host', function () {
    if (PHP_OS_FAMILY !== 'Linux') {
        $this->markTestSkipped('Process liveness is only checked on Linux.');
    }
    $dead = storedTransfer(['status' => TransferStatus::Running, 'worker_host' => gethostname(), 'worker_pid' => 4194999]);
    $alive = storedTransfer(['status' => TransferStatus::Running, 'worker_host' => gethostname(), 'worker_pid' => getmypid()]);
    $elsewhere = storedTransfer(['status' => TransferStatus::Running, 'worker_host' => 'another-host', 'worker_pid' => 4194999]);

    TransferStorage::prune();

    expect($dead->fresh()->status)->toBe(TransferStatus::Failed)
        ->and($alive->fresh()->status)->toBe(TransferStatus::Running)
        ->and($elsewhere->fresh()->status)->toBe(TransferStatus::Running);
});

it('abandons an upload once no chunk has arrived for the idle time', function () {
    config(['dbzuper.transfer_upload_idle_minutes' => 10]);
    $idle = storedTransfer(['status' => TransferStatus::Uploading, 'direction' => TransferDirection::Import]);
    $idle->forceFill(['updated_at' => now()->subMinutes(11)])->saveQuietly();
    $active = storedTransfer(['status' => TransferStatus::Uploading, 'direction' => TransferDirection::Import]);
    $active->forceFill(['updated_at' => now()->subMinutes(9)])->saveQuietly();

    TransferStorage::prune();

    expect($idle->fresh()->status)->toBe(TransferStatus::Failed)
        ->and($idle->fresh()->error)->toBe('Upload abandoned')
        ->and($idle->fresh()->file_path)->toBeNull()
        ->and($idle->fresh()->finished_at)->not->toBeNull()
        ->and(is_dir(storage_path('app/private/transfers/'.$idle->id)))->toBeFalse()
        ->and($active->fresh()->status)->toBe(TransferStatus::Uploading)
        ->and(is_file($active->file_path))->toBeTrue();
});

it('leaves an upload alone when its last chunk lands between the sweep reading it and failing it', function () {
    config(['dbzuper.transfer_upload_idle_minutes' => 10]);
    $t = storedTransfer(['status' => TransferStatus::Uploading, 'direction' => TransferDirection::Import]);
    $t->forceFill(['updated_at' => now()->subMinutes(11)])->saveQuietly();

    // The sweep has read the row; before it updates it, the last chunk completes the upload (another request).
    $raced = false;
    Transfer::retrieved(function (Transfer $read) use ($t, &$raced) {
        if (! $raced && $read->id === $t->id) {
            $raced = true;
            Transfer::query()->whereKey($t->id)->update(['status' => TransferStatus::Pending->value, 'updated_at' => now()]);
        }
    });

    TransferStorage::prune();

    expect($raced)->toBeTrue()
        ->and($t->fresh()->status)->toBe(TransferStatus::Pending)
        ->and($t->fresh()->error)->toBeNull()
        ->and($t->fresh()->file_path)->toBe($t->file_path)
        ->and(is_file($t->file_path))->toBeTrue();
});
