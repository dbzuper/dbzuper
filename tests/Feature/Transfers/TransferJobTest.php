<?php

use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Jobs\TransferJob;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\TransferProgress;
use App\Transfers\WorkerHeartbeat;

class TestJob extends TransferJob
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

function jobTransfer(?SavedConnection $c = null): Transfer
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
    $t = jobTransfer();
    TestJob::$perform = function (Transfer $t, TransferProgress $p) {
        expect($t->fresh()->status)->toBe(TransferStatus::Running);
        $p->advance(10, 2, 1, 'users');
        $p->flush();
    };

    (new TestJob($t->id))->handle();

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
    $t = jobTransfer();
    TestJob::$perform = function (Transfer $t, TransferProgress $p) {
        Transfer::whereKey($t->id)->update(['cancel_requested_at' => now()]);
        $p->checkCancelled();
        throw new RuntimeException('not reached');
    };

    $job = new TestJob($t->id);
    $job->handle();

    expect($t->fresh()->status)->toBe(TransferStatus::Cancelled)
        ->and($t->fresh()->finished_at)->not->toBeNull()
        ->and($job->cancelled)->toBeTrue();
});

it('marks failed with the password removed from the message', function () {
    $c = SavedConnection::factory()->create(['password' => 'hunter2-secret']);
    $t = jobTransfer($c);
    TestJob::$perform = fn () => throw new RuntimeException('login failed using hunter2-secret; password=abc123 PGPASSWORD=xyz ok');

    $job = new TestJob($t->id);
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
    $t = jobTransfer($c);
    TestJob::$perform = fn () => throw new RuntimeException('boom');

    (new TestJob($t->id))->handle();

    expect($t->fresh()->error)->toBe('boom');
});

it('marks failed when the worker crashes', function () {
    $t = jobTransfer();

    (new TestJob($t->id))->failed(new RuntimeException('killed'));

    expect($t->fresh()->status)->toBe(TransferStatus::Failed)
        ->and($t->fresh()->error)->toBe('killed');
});

it('is never retried and runs on the transfers queue', function () {
    $job = new TestJob('x');

    expect($job->tries)->toBe(1)
        ->and($job->timeout)->toBe(0)
        ->and($job->connection)->toBe('transfers')
        ->and($job->queue)->toBe('transfers');
});
