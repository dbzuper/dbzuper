<?php

use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Jobs\TransferJob;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\TransferProgress;
use App\Transfers\WorkerHeartbeat;

class FakeTransferJob extends TransferJob
{
    public static ?Closure $perform = null;

    public bool $cancelled = false;

    public ?string $failedWith = null;

    protected function perform(Transfer $t, TransferProgress $p): void
    {
        (self::$perform)($t, $p);
    }

    protected function onCancelled(Transfer $t): void
    {
        $this->cancelled = true;
    }

    protected function onFailed(Transfer $t, Throwable $e): void
    {
        $this->failedWith = $t->error;
    }
}

function fakeJobTransfer(?SavedConnection $c = null): Transfer
{
    $c ??= SavedConnection::factory()->create();

    return Transfer::create([
        'user_id' => $c->user_id,
        'saved_connection_id' => $c->id,
        'database' => '',
        'direction' => TransferDirection::Export,
        'method' => TransferMethod::Builtin,
        'options' => [],
        'status' => TransferStatus::Pending,
        'file_name' => 'dump.sql',
    ]);
}

it('marks done', function () {
    $t = fakeJobTransfer();
    FakeTransferJob::$perform = function (Transfer $t, TransferProgress $p) {
        expect($t->fresh()->status)->toBe(TransferStatus::Running);
        $p->advance(10, 2, 1, 'users');
        $p->flush();
    };

    (new FakeTransferJob($t->id))->handle();

    $t->refresh();
    expect($t->status)->toBe(TransferStatus::Done)
        ->and($t->started_at)->not->toBeNull()
        ->and($t->finished_at)->not->toBeNull()
        ->and($t->bytes_done)->toBe(10)
        ->and($t->rows_done)->toBe(2)
        ->and($t->statements_done)->toBe(1)
        ->and($t->current_table)->toBe('users')
        ->and(WorkerHeartbeat::alive())->toBeTrue();
});

it('marks cancelled when cancel is requested during perform', function () {
    $t = fakeJobTransfer();
    FakeTransferJob::$perform = function (Transfer $t, TransferProgress $p) {
        Transfer::whereKey($t->id)->update(['cancel_requested_at' => now()]);
        $p->checkCancelled();
        throw new RuntimeException('not reached');
    };

    $job = new FakeTransferJob($t->id);
    $job->handle();

    expect($t->fresh()->status)->toBe(TransferStatus::Cancelled)
        ->and($t->fresh()->finished_at)->not->toBeNull()
        ->and($job->cancelled)->toBeTrue();
});

it('marks failed with the password removed from the message', function () {
    $c = SavedConnection::factory()->create(['password' => 'hunter2-secret']);
    $t = fakeJobTransfer($c);
    FakeTransferJob::$perform = fn () => throw new RuntimeException('login failed using hunter2-secret; password=abc123 PGPASSWORD=xyz ok');

    $job = new FakeTransferJob($t->id);
    $job->handle();

    $t->refresh();
    expect($t->status)->toBe(TransferStatus::Failed)
        ->and($t->error)->not->toContain('hunter2-secret')
        ->and($t->error)->not->toContain('abc123')
        ->and($t->error)->not->toContain('xyz')
        ->and($t->error)->toContain('login failed')
        ->and($job->failedWith)->toBe($t->error);
});

it('copes with a connection without a password', function () {
    $c = SavedConnection::factory()->create(['password' => null]);
    $t = fakeJobTransfer($c);
    FakeTransferJob::$perform = fn () => throw new RuntimeException('boom');

    (new FakeTransferJob($t->id))->handle();

    expect($t->fresh()->error)->toBe('boom');
});

it('marks failed when the worker crashes', function () {
    $t = fakeJobTransfer();

    (new FakeTransferJob($t->id))->failed(new RuntimeException('killed'));

    expect($t->fresh()->status)->toBe(TransferStatus::Failed)
        ->and($t->fresh()->error)->toBe('killed');
});

it('is never retried and runs on the transfers queue', function () {
    $job = new FakeTransferJob('x');

    expect($job->tries)->toBe(1)
        ->and($job->timeout)->toBe(0)
        ->and($job->connection)->toBe('transfers')
        ->and($job->queue)->toBe('transfers');
});

it('does not run a transfer the dead-run sweep already failed', function () {
    $t = fakeJobTransfer();
    $t->forceFill(['status' => TransferStatus::Failed])->save();
    $ran = false;
    FakeTransferJob::$perform = function () use (&$ran) {
        $ran = true;
    };

    (new FakeTransferJob($t->id))->handle();

    expect($ran)->toBeFalse()->and($t->fresh()->status)->toBe(TransferStatus::Failed);
});

it('cancels without running when cancel was requested while queued', function () {
    $t = fakeJobTransfer();
    $t->forceFill(['cancel_requested_at' => now()])->save();
    $ran = false;
    FakeTransferJob::$perform = function () use (&$ran) {
        $ran = true;
    };

    (new FakeTransferJob($t->id))->handle();

    expect($ran)->toBeFalse()->and($t->fresh()->status)->toBe(TransferStatus::Cancelled);
});

it('records the worker and never overwrites a finished transfer on failed()', function () {
    $t = fakeJobTransfer();
    FakeTransferJob::$perform = function (Transfer $t) {
        expect($t->fresh()->worker_pid)->toBe(getmypid())
            ->and($t->fresh()->worker_host)->toBe(gethostname());
    };
    (new FakeTransferJob($t->id))->handle();

    (new FakeTransferJob($t->id))->failed(new RuntimeException('late'));

    expect($t->fresh()->status)->toBe(TransferStatus::Done);
});

it('does not run a transfer another worker already started, or one still uploading', function (TransferStatus $status) {
    $t = fakeJobTransfer();
    $t->forceFill(['status' => $status, 'started_at' => null])->save();
    $ran = false;
    FakeTransferJob::$perform = function () use (&$ran) {
        $ran = true;
    };

    (new FakeTransferJob($t->id))->handle();

    expect($ran)->toBeFalse()
        ->and($t->fresh()->status)->toBe($status)
        ->and($t->fresh()->started_at)->toBeNull();
})->with([TransferStatus::Running, TransferStatus::Uploading]);

it('moves to running only while still pending', function () {
    $t = fakeJobTransfer();
    $ran = false;
    FakeTransferJob::$perform = function () use (&$ran) {
        $ran = true;
    };
    // Another worker picks the same transfer up between the read and the move to Running.
    Transfer::retrieved(function (Transfer $model) use ($t) {
        if ($model->id === $t->id) {
            Transfer::query()->whereKey($t->id)->update(['status' => TransferStatus::Running]);
        }
    });

    (new FakeTransferJob($t->id))->handle();

    expect($ran)->toBeFalse()->and($t->fresh()->status)->toBe(TransferStatus::Running);
});
