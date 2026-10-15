<?php

namespace App\Database\Sql;

final class StatementClassifier
{
    private const DDL = ['CREATE', 'ALTER', 'COMMENT', 'GRANT', 'REVOKE', 'RENAME', 'REINDEX', 'CLUSTER', 'VACUUM', 'ANALYZE', 'OPTIMIZE', 'REPAIR', 'ATTACH', 'DETACH', 'SECURITY'];

    private const WRITE = ['INSERT', 'REPLACE', 'MERGE', 'UPSERT', 'CALL', 'DO', 'COPY', 'LOAD', 'HANDLER', 'LOCK', 'UNLOCK', 'IMPORT', 'EXECUTE', 'PREPARE', 'DEALLOCATE'];

    private const TRANSACTION = ['BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'END', 'ABORT', 'XA'];

    private const SESSION = ['SET', 'USE', 'RESET', 'DISCARD', 'LISTEN', 'NOTIFY', 'UNLISTEN'];

    public static function classify(string $sql, string $dialect): Classification
    {
        $tokens = array_values(array_filter(SqlLexer::tokenize($sql, $dialect), fn (Token $t) => $t->type !== 'comment' && $t->type !== 'semicolon'));

        return self::classifyTokens($tokens);
    }

    /** @param list<Token> $t */
    private static function classifyTokens(array $t): Classification
    {
        $first = isset($t[0]) && $t[0]->type === 'word' ? $t[0]->upper() : '';
        if ($first === '') {
            return new Classification('write', '');
        }

        return match (true) {
            in_array($first, ['EXPLAIN', 'DESCRIBE', 'DESC'], true) => self::explain($t, $first),
            $first === 'SELECT' => self::select($t),
            $first === 'WITH' => self::hasWord($t, ['INSERT', 'UPDATE', 'DELETE', 'MERGE']) ? new Classification('write', 'WITH') : self::select($t, 'WITH'),
            in_array($first, ['SHOW', 'VALUES', 'TABLE'], true) => new Classification('read', $first),
            $first === 'PRAGMA' => self::hasPunct($t, '=') ? new Classification('session', 'PRAGMA') : new Classification('read', 'PRAGMA'),
            $first === 'UPDATE', $first === 'DELETE' => self::updateOrDelete($t, $first),
            $first === 'DROP' => new Classification('destructive', 'DROP', self::nameAfter($t, 1, ['TABLE', 'VIEW', 'INDEX', 'DATABASE', 'SCHEMA', 'SEQUENCE', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'TYPE', 'MATERIALIZED', 'TEMPORARY', 'TEMP', 'IF', 'EXISTS', 'CONCURRENTLY', 'EXTENSION', 'ROLE', 'USER'])),
            $first === 'TRUNCATE' => new Classification('destructive', 'TRUNCATE', self::nameAfter($t, 1, ['TABLE', 'ONLY'])),
            in_array($first, self::TRANSACTION, true) => self::readWritePair($t) ? new Classification('session', $first) : new Classification('transaction', $first),
            in_array($first, self::SESSION, true) => new Classification('session', $first),
            in_array($first, self::DDL, true) => new Classification('ddl', $first),
            in_array($first, self::WRITE, true) => new Classification('write', $first),
            default => new Classification('write', $first),
        };
    }

    /** @param list<Token> $t */
    private static function explain(array $t, string $first): Classification
    {
        $i = 1;
        $analyze = false;
        // Skip option words and a parenthesised option list.
        while (isset($t[$i])) {
            $w = $t[$i]->type === 'word' ? $t[$i]->upper() : null;
            if ($t[$i]->type === 'punct' && $t[$i]->value === '(') {
                $depth = 0;
                for (; isset($t[$i]); $i++) {
                    if ($t[$i]->type === 'word' && $t[$i]->upper() === 'ANALYZE') {
                        $analyze = true;
                    }
                    if ($t[$i]->value === '(') {
                        $depth++;
                    } elseif ($t[$i]->value === ')' && --$depth === 0) {
                        $i++;
                        break;
                    }
                }

                continue;
            }
            if (in_array($w, ['ANALYZE', 'ANALYSE'], true)) {
                $analyze = true;
                $i++;

                continue;
            }
            if (in_array($w, ['VERBOSE', 'EXTENDED', 'PARTITIONS', 'FORMAT', 'QUERY', 'PLAN', 'FOR'], true) || $t[$i]->type === 'punct') {
                $i++;

                continue;
            }
            break;
        }

        if (! $analyze) {
            return new Classification('read', $first);
        }

        return self::classifyTokens(array_slice($t, $i));
    }

    /** @param list<Token> $t */
    private static function select(array $t, string $keyword = 'SELECT'): Classification
    {
        $depth = 0;
        foreach ($t as $k => $token) {
            if ($token->value === '(') {
                $depth++;
            } elseif ($token->value === ')') {
                $depth--;
            } elseif ($depth === 0 && $token->type === 'word') {
                $w = $token->upper();
                if ($w === 'INTO') {
                    return new Classification('write', $keyword);
                }
                if ($w === 'FOR' && isset($t[$k + 1]) && in_array($t[$k + 1]->upper(), ['UPDATE', 'SHARE', 'NO', 'KEY'], true)) {
                    return new Classification('write', $keyword);
                }
                if ($w === 'LOCK' && isset($t[$k + 1]) && $t[$k + 1]->upper() === 'IN') {
                    return new Classification('write', $keyword);
                }
            }
        }

        return new Classification('read', $keyword);
    }

    /** @param list<Token> $t */
    private static function updateOrDelete(array $t, string $first): Classification
    {
        $depth = 0;
        foreach ($t as $token) {
            if ($token->value === '(') {
                $depth++;
            } elseif ($token->value === ')') {
                $depth--;
            } elseif ($depth === 0 && $token->type === 'word' && $token->upper() === 'WHERE') {
                return new Classification('write', $first);
            }
        }

        $skip = $first === 'UPDATE' ? ['LOW_PRIORITY', 'IGNORE', 'ONLY', 'OR', 'ROLLBACK', 'ABORT', 'REPLACE', 'FAIL'] : ['LOW_PRIORITY', 'QUICK', 'IGNORE', 'FROM', 'ONLY'];

        return new Classification('destructive', $first, self::nameAfter($t, 1, $skip));
    }

    /**
     * The (possibly dotted) object name starting at $i after skipping the given keywords.
     *
     * @param  list<Token>  $t
     * @param  list<string>  $skip
     */
    private static function nameAfter(array $t, int $i, array $skip): ?string
    {
        while (isset($t[$i]) && $t[$i]->type === 'word' && in_array($t[$i]->upper(), $skip, true)) {
            $i++;
        }
        $parts = [];
        while (isset($t[$i]) && ($t[$i]->type === 'word' || $t[$i]->type === 'quoted')) {
            $parts[] = $t[$i]->identifier();
            if (isset($t[$i + 1]) && $t[$i + 1]->value === '.') {
                $i += 2;

                continue;
            }
            break;
        }

        return $parts === [] ? null : implode('.', $parts);
    }

    /**
     * @param  list<Token>  $t
     * @param  list<string>  $words
     */
    private static function hasWord(array $t, array $words): bool
    {
        foreach ($t as $token) {
            if ($token->type === 'word' && in_array($token->upper(), $words, true)) {
                return true;
            }
        }

        return false;
    }

    /** @param list<Token> $t */
    private static function hasPunct(array $t, string $punct): bool
    {
        foreach ($t as $token) {
            if ($token->type === 'punct' && $token->value === $punct) {
                return true;
            }
        }

        return false;
    }

    /**
     * "READ WRITE" anywhere relaxes a read-only session.
     *
     * @param  list<Token>  $t
     */
    private static function readWritePair(array $t): bool
    {
        foreach ($t as $k => $token) {
            if ($token->type === 'word' && $token->upper() === 'READ' && isset($t[$k + 1]) && $t[$k + 1]->type === 'word' && $t[$k + 1]->upper() === 'WRITE') {
                return true;
            }
        }

        return false;
    }
}
