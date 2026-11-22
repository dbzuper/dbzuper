<?php

namespace App\Console\Commands;

use App\Transfers\TransferStorage;
use Illuminate\Console\Command;

class RecoverTransfersCommand extends Command
{
    protected $signature = 'dbzuper:transfers:recover';

    protected $description = 'Fail backups and restores left running on this host by a restart (run before starting workers)';

    public function handle(): int
    {
        $failed = TransferStorage::failRunsOnThisHost();
        if ($failed > 0) {
            $this->line("Marked {$failed} interrupted ".($failed === 1 ? 'backup or restore' : 'backups and restores').' as failed.');
        }

        return self::SUCCESS;
    }
}
