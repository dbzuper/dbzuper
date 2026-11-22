<?php

namespace App\Transfers;

use App\Models\Transfer;

/** Collects progress in memory and saves it at most once a second, so a hot loop doesn't hit the database. */
class TransferProgress
{
    private int $bytes = 0;

    private int $rows = 0;

    private int $statements = 0;

    private ?string $table = null;

    private bool $dirty = false;

    private float $lastFlush;

    private float $lastCancelCheck = 0.0;

    public function __construct(private readonly Transfer $transfer)
    {
        $this->lastFlush = microtime(true);
    }

    public function advance(int $bytes = 0, int $rows = 0, int $statements = 0, ?string $table = null): void
    {
        $this->bytes += $bytes;
        $this->rows += $rows;
        $this->statements += $statements;
        $this->table = $table ?? $this->table;
        $this->dirty = true;

        if (microtime(true) - $this->lastFlush >= 1.0) {
            $this->flush();
        }
    }

    public function flush(): void
    {
        $this->lastFlush = microtime(true);
        WorkerHeartbeat::beat();

        if (! $this->dirty) {
            // Keeps updated_at fresh so the dead-run sweep can tell a quiet job from a dead one.
            $this->transfer->touch();

            return;
        }

        $this->transfer->forceFill([
            'bytes_done' => $this->transfer->bytes_done + $this->bytes,
            'rows_done' => $this->transfer->rows_done + $this->rows,
            'statements_done' => $this->transfer->statements_done + $this->statements,
            'current_table' => $this->table ?? $this->transfer->current_table,
        ])->save();

        $this->bytes = $this->rows = $this->statements = 0;
        $this->dirty = false;
    }

    /** @throws TransferCancelled */
    public function checkCancelled(): void
    {
        if (microtime(true) - $this->lastCancelCheck < 1.0) {
            return;
        }

        $this->lastCancelCheck = microtime(true);

        if ($this->transfer->cancelRequested()) {
            throw new TransferCancelled('Cancelled');
        }
    }
}
