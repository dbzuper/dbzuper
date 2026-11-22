<?php

namespace App\Transfers\Import;

use RuntimeException;
use Throwable;

/**
 * A statement of the dump failed (or, with statement number 0, the restore failed after its last statement: the
 * commit or SQLite's closing foreign key check). The message is the database error, safe to show as is.
 */
final class RestoreFailed extends RuntimeException
{
    public function __construct(
        public readonly int $statementNumber,
        /** The first 300 characters of the failed statement ('' when no single statement failed). */
        public readonly string $snippet,
        string $message,
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }
}
