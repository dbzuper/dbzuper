<?php

namespace App\Database\Drivers\Concerns;

use Illuminate\Database\Connection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;

trait AppliesTimeoutBestEffort
{
    /** Runs a session timeout statement; servers lacking the variable keep working without it. */
    protected function setTimeoutBestEffort(Connection $db, string $sql): void
    {
        try {
            $db->statement($sql);
        } catch (QueryException $e) {
            Log::debug('Statement timeout not applied: '.$e->getMessage(), ['driver' => $this->name()->value]);
        }
    }
}
