<?php

namespace App\Database\Sql;

/**
 * Masks credential literals in SQL before it is stored (query history). Token-based, so quoting tricks
 * (comments, doubled quotes, dollar-quoted and E'' strings) cannot hide a secret from it.
 *
 * Covered: PASSWORD [FOR user] [=|(] 'x' (also ENCRYPTED PASSWORD, WITH PASSWORD and PASSWORD('x')), and in a statement
 * with IDENTIFIED: BY / AS / USING [PASSWORD|RANDOM PASSWORD] 'x' (also IDENTIFIED WITH plugin BY 'x').
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
     * @return array{sql: string, secrets: list<string>} the masked SQL and the literal texts that were masked
     *                                                   (so callers can scrub them from text derived from the SQL, e.g. DB error messages; never persist them)
     */
    public static function scan(string $sql, string $dialect): array
    {
        $tokens = array_values(array_filter(
            SqlLexer::tokenize($sql, $dialect),
            fn (Token $t) => $t->type !== 'comment',
        ));

        $spans = [];
        $identified = false;
        foreach ($tokens as $k => $token) {
            if ($token->type === 'semicolon') {
                $identified = false;

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

            $from = null;
            if ($word === 'PASSWORD') {
                $from = self::afterPassword($tokens, $k + 1);
            } elseif ($identified && in_array($word, ['BY', 'AS', 'USING'], true)) {
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

            // An E/N/X/B string prefix is lexed as its own word right before the literal.
            if (isset($tokens[$from + 1]) && self::isStringPrefix($tokens[$from], $tokens[$from + 1])) {
                $from++;
            }

            $span = self::literalSpan($tokens, $from);
            if ($span !== null) {
                $spans[$span[0]] = $span;
            }
        }

        if ($spans === []) {
            return ['sql' => $sql, 'secrets' => []];
        }

        krsort($spans);
        $secrets = [];
        foreach ($spans as [$start, $end]) {
            $secrets[] = substr($sql, $start, $end - $start);
            $sql = substr($sql, 0, $start).self::MASK.substr($sql, $end);
        }

        return ['sql' => $sql, 'secrets' => $secrets];
    }

    /** Index of the token after PASSWORD, stepping over "FOR user[@host] " in SET PASSWORD FOR ... = 'x'. */
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
     * Start/end offsets of the string literal at token $i, including an adjacent E/N/X/B prefix.
     *
     * @param  list<Token>  $tokens
     * @return array{int, int}|null
     */
    private static function literalSpan(array $tokens, int $i): ?array
    {
        $token = $tokens[$i] ?? null;
        if ($token === null || $token->type !== 'string') {
            return null;
        }
        $start = $token->start;
        $prev = $tokens[$i - 1] ?? null;
        if ($prev !== null && self::isStringPrefix($prev, $token)) {
            $start = $prev->start;
        }

        return [$start, $token->end];
    }

    private static function isStringPrefix(Token $prefix, Token $string): bool
    {
        return $prefix->type === 'word' && $string->type === 'string' && $prefix->end === $string->start
            && in_array(strtoupper($prefix->value), ['E', 'N', 'X', 'B'], true);
    }
}
