<?php

namespace App\Database\Query;

use App\Database\Query\Exceptions\ConfirmationRequired;
use App\Database\Query\Exceptions\ReadOnlyStatement;
use App\Database\Sql\Classification;
use App\Models\SavedConnection;

final class QueryGuard
{
    private const FREE = ['read', 'transaction'];

    /** @param list<array{sql: string, classification: Classification, confirmed: bool, typed: ?string}> $items */
    public function check(SavedConnection $connection, array $items): void
    {
        if ($connection->read_only) {
            foreach ($items as $i => $item) {
                if (! in_array($item['classification']->kind, self::FREE, true)) {
                    throw new ReadOnlyStatement($i, $item['classification']);
                }
            }
        }

        foreach ($items as $i => $item) {
            $c = $item['classification'];
            if (in_array($c->kind, self::FREE, true)) {
                continue;
            }
            if ($c->kind === 'destructive') {
                // Without a table to name, the statement's keyword (DROP, TRUNCATE, ...) is what must be typed.
                $expected = $c->target ?? $c->keyword;
                if ($item['typed'] !== $expected) {
                    throw new ConfirmationRequired($i, 'typed', new Classification($c->kind, $c->keyword, $expected));
                }

                continue;
            }
            if (! $item['confirmed']) {
                throw new ConfirmationRequired($i, 'confirm', $c);
            }
        }
    }
}
