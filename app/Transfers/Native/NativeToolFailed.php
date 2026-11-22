<?php

namespace App\Transfers\Native;

use RuntimeException;

/** A native dump tool exited with an error. The message is its stderr with credentials removed, safe to show. */
final class NativeToolFailed extends RuntimeException
{
    public function __construct(string $message, public readonly ?int $exitCode = null)
    {
        parent::__construct($message);
    }
}
