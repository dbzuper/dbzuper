<?php

namespace App\Transfers;

use Illuminate\Support\Facades\Cache;

/** Proof that a transfers worker is running: workers beat while idle (Queue::looping) and while busy (TransferProgress). */
class WorkerHeartbeat
{
    private const KEY = 'dbzuper.transfer-worker.seen';

    public static function beat(): void
    {
        Cache::put(self::KEY, now()->getTimestamp(), 3600);
    }

    public static function alive(int $withinSeconds = 15): bool
    {
        $seen = Cache::get(self::KEY);

        return is_int($seen) && now()->getTimestamp() - $seen <= $withinSeconds;
    }
}
