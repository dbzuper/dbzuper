<?php

namespace App\Transfers\Import;

/**
 * One unit read from a dump file by SqlStream.
 *
 * - `sql`: a statement without its terminator; `$delimiter` is the delimiter in force, `$number` counts sql
 *   pieces from 1 in file order.
 * - `meta`: a psql backslash line (no newline).
 * - `copy_data`: the raw rows after `COPY … FROM stdin;` up to and including the `\.` line, line endings "\n".
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
