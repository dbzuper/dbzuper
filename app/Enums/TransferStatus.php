<?php

namespace App\Enums;

enum TransferStatus: string
{
    case Uploading = 'uploading';
    case Pending = 'pending';
    case Running = 'running';
    case Done = 'done';
    case Failed = 'failed';
    case Cancelled = 'cancelled';

    /** Still waiting for bytes or a worker, or being worked on. */
    public function isActive(): bool
    {
        return match ($this) {
            self::Uploading, self::Pending, self::Running => true,
            default => false,
        };
    }

    public function isFinished(): bool
    {
        return ! $this->isActive();
    }
}
