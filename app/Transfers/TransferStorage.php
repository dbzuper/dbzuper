<?php

namespace App\Transfers;

use App\Enums\TransferDirection;
use App\Enums\TransferStatus;
use App\Models\Transfer;
use Illuminate\Support\Facades\File;

/** Where transfer files live (storage/app/private/transfers/{id}) and when they are removed. */
class TransferStorage
{
    /** Finished transfers stay listed this many days after they end. */
    private const HISTORY_DAYS = 7;

    /** A running transfer saves progress every second: this long without a save means its worker died. */
    private const STALE_RUN_HOURS = 6;

    public static function directory(Transfer $transfer): string
    {
        $directory = storage_path('app/private/transfers/'.$transfer->id);
        File::ensureDirectoryExists($directory);

        return $directory;
    }

    public static function deleteFiles(Transfer $transfer): void
    {
        File::deleteDirectory(storage_path('app/private/transfers/'.$transfer->id));
    }

    /** Fails Running transfers whose worker is gone: its process no longer exists on this host, or nothing was saved for 6 hours. */
    public static function failDeadRuns(): void
    {
        $host = gethostname();
        $canCheckPid = PHP_OS_FAMILY === 'Linux';

        Transfer::query()
            ->where('status', TransferStatus::Running)
            ->chunkById(100, function ($transfers) use ($host, $canCheckPid) {
                foreach ($transfers as $transfer) {
                    $stale = $transfer->updated_at !== null && $transfer->updated_at->lte(now()->subHours(self::STALE_RUN_HOURS));
                    $dead = $canCheckPid
                        && $transfer->worker_pid !== null
                        && $transfer->worker_host === $host
                        && ! is_dir('/proc/'.$transfer->worker_pid);

                    if ($stale || $dead) {
                        $transfer->forceFill([
                            'status' => TransferStatus::Failed,
                            'error' => 'The background worker stopped while this was running.',
                            'finished_at' => now(),
                        ])->save();
                    }
                }
            });
    }

    /** Removes expired files, fails abandoned uploads and deletes old history rows. Running transfers are left alone. */
    public static function prune(): void
    {
        self::failDeadRuns();

        $ttl = (int) config('dbzuper.transfer_ttl_hours');
        $finished = array_map(
            fn (TransferStatus $s) => $s->value,
            array_values(array_filter(TransferStatus::cases(), fn (TransferStatus $s) => $s->isFinished())),
        );

        // Files of finished transfers past their expiry (or, with none set, one TTL after they ended).
        Transfer::query()
            ->whereIn('status', $finished)
            ->whereNotNull('file_path')
            ->where(fn ($q) => $q->where('expires_at', '<=', now())
                ->orWhere(fn ($q) => $q->whereNull('expires_at')->where('finished_at', '<=', now()->subHours($ttl))))
            ->chunkById(100, function ($transfers) {
                foreach ($transfers as $transfer) {
                    self::deleteFiles($transfer);
                    $transfer->forceFill(['file_path' => null, 'file_size' => null])->save();
                }
            });

        // Uploads nobody finished.
        Transfer::query()
            ->where('status', TransferStatus::Uploading)
            ->where('direction', TransferDirection::Import)
            ->where('updated_at', '<=', now()->subHours($ttl))
            ->chunkById(100, function ($transfers) {
                foreach ($transfers as $transfer) {
                    self::deleteFiles($transfer);
                    $transfer->forceFill([
                        'status' => TransferStatus::Failed,
                        'error' => 'Upload abandoned',
                        'file_path' => null,
                        'finished_at' => now(),
                    ])->save();
                }
            });

        // History rows.
        Transfer::query()
            ->where('finished_at', '<=', now()->subDays(self::HISTORY_DAYS))
            ->chunkById(100, function ($transfers) {
                foreach ($transfers as $transfer) {
                    self::deleteFiles($transfer);
                    $transfer->delete();
                }
            });
    }
}
