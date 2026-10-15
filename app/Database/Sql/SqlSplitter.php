<?php

namespace App\Database\Sql;

final class SqlSplitter
{
    /** @return list<array{sql: string, start: int, end: int}> */
    public static function split(string $sql, string $dialect): array
    {
        $out = [];
        $start = null;
        $end = null;
        $significant = false;

        $flush = function () use (&$out, &$start, &$end, &$significant, $sql) {
            if ($start !== null && $significant) {
                $out[] = ['sql' => substr($sql, $start, $end - $start), 'start' => $start, 'end' => $end];
            }
            $start = $end = null;
            $significant = false;
        };

        foreach (SqlLexer::tokenize($sql, $dialect) as $token) {
            if ($token->type === 'semicolon') {
                $flush();

                continue;
            }
            $start ??= $token->start;
            $end = $token->end;
            if ($token->type !== 'comment') {
                $significant = true;
            }
        }
        $flush();

        return $out;
    }
}
