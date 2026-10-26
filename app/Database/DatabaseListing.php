<?php

namespace App\Database;

/** The databases on a server, and the server's version when it could be read. */
final readonly class DatabaseListing
{
    /** @param  list<DatabaseEntry>  $databases */
    public function __construct(
        public array $databases,
        public ?string $version,
    ) {}
}
