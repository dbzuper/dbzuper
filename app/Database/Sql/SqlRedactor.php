<?php

namespace App\Database\Sql;

/**
 * Masks credential literals in SQL before it is stored (query history). Token-based, so quoting tricks
 * (comments, doubled quotes, dollar-quoted, E'', U&'', charset-introduced and concatenated strings) cannot hide a
 * secret from it.
 *
 * Whole literal masked as '***':
 *  - PASSWORD [FOR user] [=|(] 'x' and any *_PASSWORD option (SOURCE_PASSWORD, MASTER_PASSWORD, ...);
 *  - in a statement with IDENTIFIED: BY / AS / USING [PASSWORD|RANDOM PASSWORD] 'x' (also IDENTIFIED WITH plugin BY 'x');
 *  - REPLACE 'old' after one of the above (the old password of ALTER USER ... REPLACE / SET PASSWORD ... REPLACE).
 * Only the value masked (as ***), the rest of the literal kept: password=... inside a connection string literal
 * after CONNECTION (CREATE/ALTER SUBSCRIPTION) and inside the arguments of dblink*(...).
 */
final class SqlRedactor
{
    public const MASK = "'***'";

    /** @return string the SQL with credential literals replaced by '***' */
    public static function redact(string $sql, string $dialect): string
    {
        return self::scan($sql, $dialect)['sql'];
    }

    /**
     * @return array{sql: string, secrets: list<string>} the masked SQL and the texts that were masked: each literal as
     *                                                   written and its decoded value (so callers can scrub text derived from the SQL, e.g. DB error
     *                                                   messages; never persist them). Decoded values shorter than 4 characters are left out: they
     *                                                   would mangle unrelated text.
     */
    public static function scan(string $sql, string $dialect): array
    {
        $tokens = array_values(array_filter(
            SqlLexer::tokenize($sql, $dialect),
            fn (Token $t) => $t->type !== 'comment',
        ));
        $backslash = $dialect === 'mysql' || $dialect === 'mariadb';

        /** @var array<int, array{int, string}> $spans start => [end, replacement] */
        $spans = [];
        $secrets = [];
        $identified = false;
        $masked = false;

        foreach ($tokens as $k => $token) {
            if ($token->type === 'semicolon') {
                $identified = false;
                $masked = false;

                continue;
            }
            if ($token->type !== 'word') {
                continue;
            }
            $word = $token->upper();
            if ($word === 'IDENTIFIED') {
                $identified = true;

                continue;
            }

            if ($word === 'CONNECTION' && isset($tokens[$k + 1])) {
                $run = self::run($tokens, $k + 1);
                if ($run !== null) {
                    self::maskConnectionString($tokens[$run[1]], $spans, $secrets);
                }

                continue;
            }
            if (str_starts_with($word, 'DBLINK') && isset($tokens[$k + 1]) && self::isPunct($tokens[$k + 1], '(')) {
                $end = self::groupEnd($tokens, $k + 1);
                for ($j = $k + 2; $j < $end; $j++) {
                    if ($tokens[$j]->type === 'string') {
                        self::maskConnectionString($tokens[$j], $spans, $secrets);
                    }
                }

                continue;
            }

            $from = null;
            if ($word === 'PASSWORD' || str_ends_with($word, '_PASSWORD')) {
                $from = self::afterPassword($tokens, $k + 1);
            } elseif ($identified && in_array($word, ['BY', 'AS', 'USING'], true)) {
                $from = $k + 1;
            } elseif ($word === 'REPLACE' && $masked) {
                $from = $k + 1;
            }
            if ($from === null) {
                continue;
            }

            // Skip PASSWORD / RANDOM, "=" and "(" between the keyword and the literal.
            while (isset($tokens[$from]) && (
                ($tokens[$from]->type === 'word' && in_array($tokens[$from]->upper(), ['PASSWORD', 'RANDOM'], true))
                || ($tokens[$from]->type === 'punct' && in_array($tokens[$from]->value, ['=', '('], true))
            )) {
                $from++;
            }

            $run = self::run($tokens, $from);
            if ($run === null) {
                continue;
            }
            [$first, $last] = $run;
            $start = $tokens[$first]->start;
            $end = $tokens[$last]->end;
            $spans[$start] = [$end, self::MASK];
            $masked = true;
            $secrets[] = substr($sql, $start, $end - $start);
            $decoded = '';
            for ($i = $first; $i <= $last; $i++) {
                if ($tokens[$i]->type === 'string') {
                    $e = $i > $first && strtoupper($tokens[$i - 1]->value) === 'E' && $tokens[$i - 1]->end === $tokens[$i]->start;
                    $decoded .= self::decode($tokens[$i]->value, $backslash || $e);
                }
            }
            if (strlen($decoded) >= 4) {
                $secrets[] = $decoded;
            }
        }

        if ($spans === []) {
            return ['sql' => $sql, 'secrets' => []];
        }

        krsort($spans);
        foreach ($spans as $start => [$end, $replacement]) {
            $sql = substr($sql, 0, $start).$replacement.substr($sql, $end);
        }

        return ['sql' => $sql, 'secrets' => array_values(array_unique($secrets))];
    }

    /**
     * Masks the value of password=... inside a string literal token, keeping the rest of the literal.
     *
     * @param  array<int, array{int, string}>  $spans
     * @param  list<string>  $secrets
     */
    private static function maskConnectionString(Token $token, array &$spans, array &$secrets): void
    {
        if ($token->type !== 'string') {
            return;
        }
        $head = '';
        $tail = '';
        $body = $token->value;
        if (preg_match('/^(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)(.*)(\1)$/s', $body, $m)) {
            [$head, $body, $tail] = [$m[1], $m[2], $m[3]];
        }
        $changed = preg_replace_callback(
            '/(password\s*=\s*)(\'\'(?:(?!\'\').)*\'\'|\'[^\']*\'|(?:\\\\.|[^\s\'\\\\])+)/is',
            function (array $m) use (&$secrets): string {
                $value = trim($m[2], "'");
                if ($value !== '') {
                    $secrets[] = $value;
                }

                return $m[1].'***';
            },
            $body,
        );
        if ($changed !== null && $changed !== $body) {
            $spans[$token->start] = [$token->end, $head.$changed.$tail];
        }
    }

    /**
     * Index of the token after PASSWORD, stepping over "FOR user[@host] " in SET PASSWORD FOR ... = 'x'.
     *
     * @param  list<Token>  $tokens
     */
    private static function afterPassword(array $tokens, int $i): int
    {
        if (isset($tokens[$i]) && $tokens[$i]->type === 'word' && $tokens[$i]->upper() === 'FOR') {
            for ($j = $i + 1; $j < $i + 12 && isset($tokens[$j]); $j++) {
                if ($tokens[$j]->type === 'punct' && $tokens[$j]->value === '=') {
                    return $j;
                }
            }
        }

        return $i;
    }

    /**
     * The string literal starting at token $i as [firstToken, lastToken]: an optional prefix (E/N/X/B, a _charset
     * introducer or U&), the string, and any directly following literals ('a' 'b' concatenate).
     *
     * @param  list<Token>  $tokens
     * @return array{int, int}|null
     */
    private static function run(array $tokens, int $i): ?array
    {
        $end = self::literalEnd($tokens, $i);
        if ($end === null) {
            return null;
        }
        while (($next = self::literalEnd($tokens, $end + 1)) !== null) {
            $end = $next;
        }

        return [$i, $end];
    }

    /**
     * Index of the string token of the (prefixed) literal starting at $i, or null.
     *
     * @param  list<Token>  $tokens
     */
    private static function literalEnd(array $tokens, int $i): ?int
    {
        $t = $tokens[$i] ?? null;
        if ($t === null) {
            return null;
        }
        if ($t->type === 'string') {
            return $i;
        }
        $a = $tokens[$i + 1] ?? null;
        if ($t->type !== 'word' || $a === null) {
            return null;
        }
        if ($a->type === 'string' && $a->start === $t->end && preg_match('/^(?:[ENXB]|_[A-Za-z0-9]+)$/i', $t->value)) {
            return $i + 1;
        }
        $b = $tokens[$i + 2] ?? null;
        if (strtoupper($t->value) === 'U' && self::isPunct($a, '&') && $a->start === $t->end && $b !== null && $b->type === 'string' && $b->start === $a->end) {
            return $i + 2;
        }

        return null;
    }

    /** The value of a string token without quotes (doubled quotes and, where they escape, backslashes undone). */
    private static function decode(string $literal, bool $backslash): string
    {
        if (preg_match('/^(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)(.*?)(\1)?$/s', $literal, $m)) {
            return $m[2];
        }
        $q = $literal[0];
        $inner = substr($literal, 1);
        if (str_ends_with($inner, $q) && ! preg_match('/(?<!\\\\)(?:\\\\\\\\)*\\\\$/', substr($inner, 0, -1))) {
            $inner = substr($inner, 0, -1);
        }
        $inner = str_replace($q.$q, $q, $inner);

        return $backslash ? (string) preg_replace('/\\\\(.)/s', '$1', $inner) : $inner;
    }

    /** @param list<Token> $tokens */
    private static function groupEnd(array $tokens, int $open): int
    {
        $depth = 0;
        for ($i = $open; isset($tokens[$i]); $i++) {
            if (self::isPunct($tokens[$i], '(')) {
                $depth++;
            } elseif (self::isPunct($tokens[$i], ')') && --$depth === 0) {
                return $i;
            }
        }

        return $i;
    }

    private static function isPunct(Token $token, string $value): bool
    {
        return $token->type === 'punct' && $token->value === $value;
    }
}
