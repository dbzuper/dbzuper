<?php

namespace App\Transfers;

/** Free space where transfer files live; a class so tests can stand in for the disk. */
class DiskSpace
{
    /** Kept free beyond the upload itself, for the database, logs and the rest of the app. */
    public const MARGIN_BYTES = 1024 * 1024 * 1024;

    /** Free bytes on the disk holding the transfers directory, or null when the system can't tell. */
    public function free(): ?float
    {
        $directory = storage_path('app/private');
        $free = @disk_free_space(is_dir($directory) ? $directory : storage_path());

        return $free === false ? null : $free;
    }
}
