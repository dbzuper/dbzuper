<?php

namespace App\Database\Editing;

use RuntimeException;

/** A change the grid would never offer (spec §5): the message is ours and safe to show; `field` is the request path. */
final class ChangeSetRejected extends RuntimeException
{
    public function __construct(public readonly string $field, string $message)
    {
        parent::__construct($message);
    }
}
