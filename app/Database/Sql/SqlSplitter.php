<?php

namespace App\Database\Sql;

final class SqlSplitter
{
    /** @return list<array{sql: string, start: int, end: int}> */
    public static function split(string $sql, string $dialect): array
    {
        $out = [];
        $start = null;
        $end = 0;
        $significant = false;

        // A trailing null ends the last statement like a semicolon would.
        foreach ([...SqlLexer::tokenize($sql, $dialect), null] as $token) {
            if ($token === null || $token->type === 'semicolon') {
                if ($start !== null && $significant) {
                    $out[] = ['sql' => substr($sql, $start, $end - $start), 'start' => $start, 'end' => $end];
                }
                $start = null;
                $significant = false;

                continue;
            }
            $start ??= $token->start;
            $end = $token->end;
            if ($token->type !== 'comment') {
                $significant = true;
            }
        }

        return $out;
    }
}
