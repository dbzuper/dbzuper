<?php

namespace App\Transfers\Import;

/**
 * One unit read from a dump file by SqlStream.
 *
 * - `sql`: a statement without its terminator; `$delimiter` is the delimiter in force, `$number` counts sql
 *   pieces from 1 in file order.
 * - `meta`: a psql backslash line (no newline).
 * - `copy_data`: raw rows after `COPY … FROM stdin;`. One COPY block comes as one or more consecutive pieces of
 *   whole lines (each at most ~4 MB unless a single line is longer); the last piece ends with the `\.` line.
 *   Text-format rows have "\n" line endings (CRLF normalised); CSV rows are passed through untouched. The
 *   `\.` line itself is always "\\.\n".
 * - `delimiter`: a MySQL `DELIMITER x` line; `$text` (and `$delimiter`) is the new delimiter.
 */
final readonly class SqlPiece
{
    /** @param 'sql'|'meta'|'copy_data'|'delimiter' $kind */
    public function __construct(
        public string $kind,
        public string $text,
        public string $delimiter = ';',
        public int $number = 0,
    ) {}
}
