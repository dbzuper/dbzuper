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

it('removes the transfer files of a deleted connection, failing and cancelling active ones first', function () {
    $done = storedTransfer(['status' => TransferStatus::Done, 'finished_at' => now()]);
    $connection = SavedConnection::query()->findOrFail($done->saved_connection_id);
    $running = Transfer::create([...$done->only(['user_id', 'saved_connection_id', 'database', 'direction', 'method', 'options', 'file_name']), 'status' => TransferStatus::Running]);
    file_put_contents(TransferStorage::directory($running).'/export.sql', 'partial');
    $other = storedTransfer(['status' => TransferStatus::Done, 'finished_at' => now()]);

    // What a worker still on the running transfer would read just before the rows go.
    $seen = null;
    SavedConnection::deleting(function () use ($running, &$seen) {
        $seen = Transfer::query()->find($running->id);
    });

    $connection->delete();

    expect(Transfer::find($done->id))->toBeNull()
        ->and(Transfer::find($running->id))->toBeNull()
        ->and(is_dir(storage_path('app/private/transfers/'.$done->id)))->toBeFalse()
        ->and(is_dir(storage_path('app/private/transfers/'.$running->id)))->toBeFalse()
        ->and($seen->status)->toBe(TransferStatus::Failed)
        ->and($seen->error)->toBe('The connection was deleted.')
        ->and($seen->cancel_requested_at)->not->toBeNull()
        ->and(is_file($other->file_path))->toBeTrue();
});

it('removes the transfer files of a deleted user', function () {
    $mine = storedTransfer(['status' => TransferStatus::Uploading, 'direction' => TransferDirection::Import]);
    $theirs = storedTransfer(['status' => TransferStatus::Done, 'finished_at' => now()]);

    App\Models\User::query()->findOrFail($mine->user_id)->delete();

    expect(Transfer::find($mine->id))->toBeNull()
        ->and(is_dir(storage_path('app/private/transfers/'.$mine->id)))->toBeFalse()
        ->and(is_file($theirs->file_path))->toBeTrue();
});

it('prunes directories no transfer owns once they are older than the file TTL', function () {
    config(['dbzuper.transfer_ttl_hours' => 24]);
    $root = storage_path('app/private/transfers');
    $old = $root.'/'.Illuminate\Support\Str::uuid();
    $recent = $root.'/'.Illuminate\Support\Str::uuid();
    File::ensureDirectoryExists($old);
    File::ensureDirectoryExists($recent);
    file_put_contents($old.'/export.sql', 'x');
    touch($old, now()->subHours(25)->getTimestamp());
    $owned = storedTransfer(['status' => TransferStatus::Done, 'finished_at' => now(), 'expires_at' => now()->addHour()]);
    touch(dirname($owned->file_path), now()->subHours(25)->getTimestamp());

    TransferStorage::prune();

    expect(is_dir($old))->toBeFalse()
        ->and(is_dir($recent))->toBeTrue()
        ->and(is_file($owned->file_path))->toBeTrue();
});

it('counts a process of another user as alive (EPERM), and a missing one as gone', function () {
    if (! function_exists('posix_kill')) {
        $this->markTestSkipped('Needs ext-posix.');
    }

    // PID 1 always exists; as a non-root user, signalling it is refused with EPERM. As root it simply succeeds.
    expect(TransferStorage::processAlive(1))->toBeTrue()
        ->and(TransferStorage::processAlive(getmypid()))->toBeTrue()
        ->and(TransferStorage::processAlive(4194999))->toBeFalse();
});

it('does not fail a dead run the worker finished in the meantime', function () {
    $t = storedTransfer(['status' => TransferStatus::Running]);
    $t->forceFill(['updated_at' => now()->subHours(7)])->saveQuietly();
    Transfer::retrieved(function (Transfer $read) use ($t) {
        if ($read->id === $t->id && $read->status === TransferStatus::Running) {
            Transfer::query()->whereKey($t->id)->update(['status' => TransferStatus::Done->value, 'finished_at' => now()]);
        }
    });

    TransferStorage::failDeadRuns();

    expect($t->fresh()->status)->toBe(TransferStatus::Done)
        ->and($t->fresh()->error)->toBeNull();
});
