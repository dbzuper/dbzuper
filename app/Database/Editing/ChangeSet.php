<?php

namespace App\Database\Editing;

/** Limits and execution order of a change set: the edits of one table, sent together for preview or commit. */
final class ChangeSet
{
    public const MAX_CHANGES = 500;

    /** Longest value (characters) a change may write. */
    public const MAX_VALUE_CHARS = 1_000_000;

    /** Cap on all text in one change set (values, originals, identities), for a low-memory host. */
    public const MAX_TOTAL_CHARS = 10_000_000;

    /** Execution order (spec §5.2): deletes, then updates, then inserts, so a key can be deleted and re-added. */
    public const OPS = ['delete', 'update', 'insert'];

    /**
     * @param  list<BuiltStatement>  $statements
     * @return list<BuiltStatement> in execution order, request order within each op
     */
    public static function ordered(array $statements): array
    {
        $rank = array_flip(self::OPS);
        usort($statements, fn (BuiltStatement $a, BuiltStatement $b) => [$rank[$a->op], $a->index] <=> [$rank[$b->op], $b->index]);

        return $statements;
    }
}
