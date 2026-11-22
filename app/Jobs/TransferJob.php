<?php

namespace App\Jobs;

use App\Enums\TransferStatus;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\TransferCancelled;
use App\Transfers\TransferProgress;
use App\Transfers\TransferTarget;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use LogicException;
use RuntimeException;
use Throwable;

/** Base of backup and restore jobs: runs on the `transfers` queue, once, with no time limit. */
abstract class TransferJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 0;

    public function __construct(public readonly string $transferId)
    {
        $this->onConnection('transfers');
        $this->onQueue('transfers');
    }

    abstract protected function perform(Transfer $transfer, TransferProgress $progress): void;

    public function handle(): void
    {
        $transfer = Transfer::query()->findOrFail($this->transferId);

        // Failed by the dead-run sweep, cancelled while queued, still uploading or already picked up by another
        // worker: nothing to run.
        if ($transfer->status !== TransferStatus::Pending) {
            return;
        }

        if ($transfer->cancelRequested()) {
            if ($this->claim($transfer, ['status' => TransferStatus::Cancelled, 'finished_at' => now()])) {
                $this->onCancelled($transfer->refresh());
            }

            return;
        }

        // Only one worker moves it out of Pending: a second delivery of the job, or a cancel that landed since the
        // read above, changes nothing here and the job ends.
        if (! $this->claim($transfer, [
            'status' => TransferStatus::Running,
            'started_at' => now(),
            'worker_host' => gethostname() ?: null,
            'worker_pid' => getmypid() ?: null,
        ])) {
            return;
        }
        $transfer->refresh();

        $progress = new TransferProgress($transfer);

        try {
            $this->perform($transfer, $progress);
            $progress->flush();
            $transfer->forceFill(['status' => TransferStatus::Done, 'finished_at' => now()])->save();
            try {
                $this->onDone($transfer);
            } catch (Throwable $e) {
                // The work is done and saved; a failing follow-up (history) must not turn it into a failure.
                report($e);
            }
        } catch (TransferCancelled) {
            $progress->flush();
            $transfer->forceFill(['status' => TransferStatus::Cancelled, 'finished_at' => now()])->save();
            $this->onCancelled($transfer);
        } catch (Throwable $e) {
            try {
                $progress->flush();
            } catch (Throwable) {
                // Losing the last progress beats hiding the real error.
            }
            $this->markFailed($transfer, $e);
        }
    }

    /** The worker died or the job was killed: perform()'s own catch never ran. */
    public function failed(Throwable $e): void
    {
        $transfer = Transfer::query()->find($this->transferId);

        if ($transfer !== null && $transfer->status->isActive()) {
            $this->markFailed($transfer, $e);
        }
    }

    /**
     * The connection the transfer runs against, refused when it no longer points at the database the transfer was
     * started (and, for a restore, confirmed) against.
     *
     * @param  string  $noun  "backup" or "restore"
     */
    protected function targetConnection(Transfer $transfer, string $noun): SavedConnection
    {
        $changed = "The connection was changed after this {$noun} started. Start the {$noun} again.";

        try {
            $connection = $transfer->runConnection();
        } catch (LogicException) {
            // A server-level connection made fixed since: it can no longer be scoped to the transfer's database.
            throw new RuntimeException($changed);
        }

        $stored = ($transfer->options ?? [])['target'] ?? null;
        if (! TransferTarget::matches($connection, is_array($stored) ? $stored : null)) {
            throw new RuntimeException($changed);
        }

        return $connection;
    }

    /** Called after the transfer is marked Done. */
    protected function onDone(Transfer $transfer): void {}

    /** Called after the transfer is marked Cancelled: subclasses remove partial files. */
    protected function onCancelled(Transfer $transfer): void {}

    /** Called after the transfer is marked Failed. */
    protected function onFailed(Transfer $transfer, Throwable $e): void {}

    protected function sanitizedMessage(Throwable $e, ?Transfer $transfer = null): string
    {
        $message = $e->getMessage();

        $transfer ??= Transfer::query()->find($this->transferId);
        $password = null;

        try {
            $password = $transfer?->connection()->first()?->password;
        } catch (Throwable) {
            // An undecryptable password has nothing to leak.
        }

        if (is_string($password) && $password !== '') {
            $message = str_replace($password, '***', $message);
        }

        return preg_replace('/(PGPASSWORD|password)=\S+/i', '$1=***', $message) ?? '';
    }

    /**
     * Applies the changes only while the transfer is still Pending.
     *
     * @param  array<string, mixed>  $changes
     */
    private function claim(Transfer $transfer, array $changes): bool
    {
        return Transfer::query()->whereKey($transfer->id)->where('status', TransferStatus::Pending)->update($changes) === 1;
    }

    private function markFailed(Transfer $transfer, Throwable $e): void
    {
        $transfer->forceFill([
            'status' => TransferStatus::Failed,
            'error' => $this->sanitizedMessage($e, $transfer),
            'finished_at' => now(),
        ])->save();

        $this->onFailed($transfer, $e);
    }
}
