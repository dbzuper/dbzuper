<?php

namespace App\Database\Exceptions;

use RuntimeException;

class SqlitePathNotAllowed extends RuntimeException
{
    /** @param 'missing'|'outside' $reason */
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
