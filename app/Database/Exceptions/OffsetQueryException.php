<?php

namespace App\Database\Exceptions;

use PDOException;
use RuntimeException;

/** A database error from SQL that had text prepended, so reported columns need shifting back. */
final class OffsetQueryException extends RuntimeException
{
    public function __construct(public readonly PDOException $original, public readonly int $columnOffset)
    {
        parent::__construct($original->getMessage(), 0, $original);
    }
}
