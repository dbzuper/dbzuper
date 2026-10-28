<?php

namespace App\Database\Sql;

final class StatementClassifier
{
    private const DDL = ['CREATE', 'ALTER', 'COMMENT', 'GRANT', 'REVOKE', 'RENAME', 'REINDEX', 'CLUSTER', 'VACUUM', 'ANALYZE', 'OPTIMIZE', 'REPAIR', 'ATTACH', 'DETACH', 'SECURITY'];

    private const WRITE = ['INSERT', 'REPLACE', 'MERGE', 'UPSERT', 'CALL', 'DO', 'COPY', 'LOAD', 'HANDLER', 'LOCK', 'UNLOCK', 'IMPORT', 'EXECUTE', 'PREPARE', 'DEALLOCATE'];

    private const TRANSACTION = ['BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'END', 'ABORT', 'XA'];

    /** Object kinds after DROP (multi-word kinds first so they win over their first word). */
    private const DROP_KINDS = [
        ['FOREIGN', 'DATA', 'WRAPPER'], ['FOREIGN', 'TABLE'], ['MATERIALIZED', 'VIEW'], ['EVENT', 'TRIGGER'],
        ['TEXT', 'SEARCH', 'CONFIGURATION'], ['TEXT', 'SEARCH', 'DICTIONARY'], ['TEXT', 'SEARCH', 'PARSER'], ['TEXT', 'SEARCH', 'TEMPLATE'],
        ['ACCESS', 'METHOD'], ['TABLE'], ['VIEW'], ['INDEX'], ['DATABASE'], ['SCHEMA'], ['SEQUENCE'], ['FUNCTION'], ['PROCEDURE'], ['ROUTINE'],
        ['AGGREGATE'], ['TRIGGER'], ['TYPE'], ['DOMAIN'], ['EXTENSION'], ['ROLE'], ['USER'], ['GROUP'], ['POLICY'], ['EVENT'], ['COLLATION'],
        ['RULE'], ['PUBLICATION'], ['SUBSCRIPTION'], ['SERVER'], ['TABLESPACE'], ['LANGUAGE'], ['CONVERSION'], ['STATISTICS'],
        ['OPERATOR', 'CLASS'], ['OPERATOR', 'FAMILY'], ['OPERATOR'], ['RESOURCE', 'GROUP'], ['LOGFILE', 'GROUP'], ['OWNED', 'BY'], ['TRANSFORM'], ['CAST'],
    ];

    private const SESSION = ['SET', 'USE', 'RESET', 'DISCARD', 'LISTEN', 'NOTIFY', 'UNLISTEN'];

    /** EXPLAIN (...) options and values that cannot execute the statement; anything else counts as ANALYZE. */
    private const EXPLAIN_HARMLESS = ['VERBOSE', 'COSTS', 'SETTINGS', 'BUFFERS', 'WAL', 'TIMING', 'SUMMARY', 'MEMORY', 'SERIALIZE', 'GENERIC_PLAN', 'FORMAT', 'TEXT', 'XML', 'JSON', 'YAML', 'TRUE', 'FALSE', 'ON', 'OFF', 'NONE', 'BINARY'];

    /** SQLite introspection pragmas that are read-only with or without an argument. */
    private const PRAGMA_WITH_ARG = ['TABLE_INFO', 'TABLE_XINFO', 'TABLE_LIST', 'INDEX_LIST', 'INDEX_INFO', 'INDEX_XINFO', 'FOREIGN_KEY_LIST', 'FOREIGN_KEY_CHECK', 'DATABASE_LIST', 'COLLATION_LIST', 'FUNCTION_LIST', 'MODULE_LIST', 'PRAGMA_LIST', 'COMPILE_OPTIONS', 'INTEGRITY_CHECK', 'QUICK_CHECK', 'PAGE_COUNT', 'FREELIST_COUNT'];

    /** SQLite setting pragmas that only read when given no argument. */
    private const PRAGMA_NO_ARG = ['SCHEMA_VERSION', 'USER_VERSION', 'APPLICATION_ID', 'PAGE_SIZE', 'ENCODING', 'JOURNAL_MODE', 'FOREIGN_KEYS'];

    public static function classify(string $sql, string $dialect): Classification
    {
        $all = SqlLexer::tokenize($sql, $dialect);
        $tokens = array_values(array_filter($all, fn (Token $t) => $t->type !== 'comment' && $t->type !== 'semicolon'));

        $leading = isset($tokens[0]) && $tokens[0]->type === 'word' ? $tokens[0]->upper() : '';

        // MySQL/MariaDB executable comments (/*! */, /*M! */) may run their contents depending on server
        // version, and the server's own scan ends them at the first "*/": fail closed.
        if ($dialect === 'mysql' || $dialect === 'mariadb') {
            foreach ($all as $token) {
                if ($token->type === 'comment' && preg_match('/^\/\*M?!/', $token->value)) {
                    return new Classification('write', $leading);
                }
            }
        }

        // PostgreSQL U&'...' / U&"..." can spell any identifier or string via escapes: fail closed.
        if ($dialect === 'pgsql') {
            foreach ($tokens as $k => $token) {
                if ($token->type === 'word' && strtoupper($token->value) === 'U'
                    && isset($tokens[$k + 1], $tokens[$k + 2])
                    && self::isPunct($tokens[$k + 1], '&') && $tokens[$k + 1]->start === $token->end
                    && in_array($tokens[$k + 2]->type, ['string', 'quoted'], true) && $tokens[$k + 2]->start === $tokens[$k + 1]->end) {
                    return new Classification('write', $leading);
                }
            }
        }

        // Anything significant after a semicolon means multi-statement input: never trust the first keyword.
        $seenSemicolon = false;
        foreach ($all as $token) {
            if ($token->type === 'semicolon') {
                $seenSemicolon = true;
            } elseif ($seenSemicolon && $token->type !== 'comment') {
                $first = isset($tokens[0]) && $tokens[0]->type === 'word' ? $tokens[0]->upper() : '';

                return new Classification('write', $first);
            }
        }

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
            $first === 'WITH' => self::with($t),
            $first === 'SHOW' => new Classification('read', $first),
            $first === 'VALUES', $first === 'TABLE' => self::select($t, $first),
            $first === 'PRAGMA' => self::pragma($t),
            $first === 'UPDATE', $first === 'DELETE' => self::updateOrDelete($t, $first),
            $first === 'DROP' => new Classification('destructive', 'DROP', self::dropTarget($t)),
            $first === 'TRUNCATE' => new Classification('destructive', 'TRUNCATE', self::truncateTarget($t)),
            in_array($first, self::TRANSACTION, true) => self::transaction($t, $first),
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
            if (self::isPunct($t[$i], '(')) {
                $depth = 0;
                for (; isset($t[$i]); $i++) {
                    $tok = $t[$i];
                    if (in_array($tok->type, ['word', 'quoted', 'string'], true)) {
                        $name = match ($tok->type) {
                            'word' => $tok->value,
                            'string' => trim($tok->value, "'"),
                            default => $tok->identifier(),
                        };
                        if (! in_array(strtoupper($name), self::EXPLAIN_HARMLESS, true)) {
                            $analyze = true;
                        }
                    }
                    if (self::isPunct($tok, '(')) {
                        $depth++;
                    } elseif (self::isPunct($tok, ')') && --$depth === 0) {
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
        $session = false;
        foreach ($t as $k => $token) {
            // set_config() changes session settings (e.g. default_transaction_read_only).
            if (($token->type === 'word' || $token->type === 'quoted') && strtolower($token->identifier()) === 'set_config') {
                $session = true;
            }
            if (self::isPunct($token, '(')) {
                $depth++;
            } elseif (self::isPunct($token, ')')) {
                $depth = max(0, $depth - 1);
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

        return new Classification($session ? 'session' : 'read', $keyword);
    }

    /** @param list<Token> $t */
    private static function with(array $t): Classification
    {
        $main = self::mainStatementIndex($t);
        if ($main !== null && in_array($t[$main]->upper(), ['UPDATE', 'DELETE'], true)) {
            $c = self::updateOrDelete(array_slice($t, $main), $t[$main]->upper());

            return new Classification($c->kind, 'WITH', $c->target);
        }
        if (self::hasWord($t, ['INSERT', 'UPDATE', 'DELETE', 'MERGE'])) {
            return new Classification('write', 'WITH');
        }

        return self::select($t, 'WITH');
    }

    /**
     * Index of the statement keyword that follows the CTE list, or null when the list cannot be parsed.
     *
     * @param  list<Token>  $t
     */
    private static function mainStatementIndex(array $t): ?int
    {
        $i = 1;
        if (isset($t[$i]) && $t[$i]->type === 'word' && $t[$i]->upper() === 'RECURSIVE') {
            $i++;
        }
        while (true) {
            if (! isset($t[$i]) || ! in_array($t[$i]->type, ['word', 'quoted'], true)) {
                return null;
            }
            $i++;
            if (isset($t[$i]) && self::isPunct($t[$i], '(')) {
                $i = self::skipGroup($t, $i);
            }
            if (! isset($t[$i]) || $t[$i]->type !== 'word' || $t[$i]->upper() !== 'AS') {
                return null;
            }
            $i++;
            if (isset($t[$i]) && $t[$i]->type === 'word' && $t[$i]->upper() === 'NOT') {
                $i++;
            }
            if (isset($t[$i]) && $t[$i]->type === 'word' && $t[$i]->upper() === 'MATERIALIZED') {
                $i++;
            }
            if (! isset($t[$i]) || ! self::isPunct($t[$i], '(')) {
                return null;
            }
            $i = self::skipGroup($t, $i);
            if (isset($t[$i]) && self::isPunct($t[$i], ',')) {
                $i++;

                continue;
            }

            return isset($t[$i]) && $t[$i]->type === 'word' ? $i : null;
        }
    }

    /**
     * Index just past the balanced group opening at $i.
     *
     * @param  list<Token>  $t
     */
    private static function skipGroup(array $t, int $i): int
    {
        $depth = 0;
        for (; isset($t[$i]); $i++) {
            if (self::isPunct($t[$i], '(')) {
                $depth++;
            } elseif (self::isPunct($t[$i], ')') && --$depth === 0) {
                return $i + 1;
            }
        }

        return $i;
    }

    private static function isPunct(Token $token, string $value): bool
    {
        return $token->type === 'punct' && $token->value === $value;
    }

    /** @param list<Token> $t */
    private static function pragma(array $t): Classification
    {
        $i = 1;
        if (isset($t[$i + 1]) && self::isPunct($t[$i + 1], '.')) {
            $i += 2; // schema prefix
        }
        $name = isset($t[$i]) && in_array($t[$i]->type, ['word', 'quoted'], true) ? strtoupper($t[$i]->identifier()) : '';
        $hasArg = isset($t[$i + 1]) && self::isPunct($t[$i + 1], '(');
        $readOnly = ! self::hasPunct($t, '=') && (
            in_array($name, self::PRAGMA_WITH_ARG, true)
            || (in_array($name, self::PRAGMA_NO_ARG, true) && ! $hasArg)
        );

        return new Classification($readOnly ? 'read' : 'session', 'PRAGMA');
    }

    /** @param list<Token> $t */
    private static function transaction(array $t, string $first): Classification
    {
        $second = isset($t[1]) && $t[1]->type === 'word' ? $t[1]->upper() : '';
        if ($first === 'START' && $second !== 'TRANSACTION') {
            return new Classification('write', $first);
        }
        if ($first === 'XA' && ($second === 'COMMIT' || $second === 'ROLLBACK')) {
            return new Classification('write', $first);
        }
        if (($first === 'COMMIT' || $first === 'ROLLBACK') && $second === 'PREPARED') {
            return new Classification('write', $first);
        }

        return self::readWritePair($t) ? new Classification('session', $first) : new Classification('transaction', $first);
    }

    /** @param list<Token> $t */
    private static function updateOrDelete(array $t, string $first): Classification
    {
        $depth = 0;
        foreach ($t as $token) {
            if (self::isPunct($token, '(')) {
                $depth++;
            } elseif (self::isPunct($token, ')')) {
                $depth = max(0, $depth - 1);
            } elseif ($depth === 0 && $token->type === 'word' && $token->upper() === 'WHERE') {
                return new Classification('write', $first);
            }
        }

        $skip = $first === 'UPDATE' ? ['LOW_PRIORITY', 'IGNORE', 'ONLY', 'OR', 'ROLLBACK', 'ABORT', 'REPLACE', 'FAIL'] : ['LOW_PRIORITY', 'QUICK', 'IGNORE', 'FROM', 'ONLY'];

        return new Classification('destructive', $first, self::nameAfter($t, 1, $skip));
    }

    /**
     * DROP [TEMPORARY] <kind> [CONCURRENTLY] [IF EXISTS] name [, name ...]: the comma-joined names.
     *
     * @param  list<Token>  $t
     */
    private static function dropTarget(array $t): ?string
    {
        $i = 1;
        if (isset($t[$i]) && $t[$i]->type === 'word' && in_array($t[$i]->upper(), ['TEMPORARY', 'TEMP'], true)) {
            $i++;
        }
        foreach (self::DROP_KINDS as $kind) {
            foreach ($kind as $offset => $word) {
                if (! isset($t[$i + $offset]) || $t[$i + $offset]->type !== 'word' || $t[$i + $offset]->upper() !== $word) {
                    continue 2;
                }
            }
            // DROP CAST (a AS b) / DROP TRANSFORM FOR t LANGUAGE l name no single object: keyword confirmation.
            if (in_array($kind[0], ['CAST', 'TRANSFORM'], true)) {
                return null;
            }
            $i += count($kind);

            break;
        }
        if (isset($t[$i]) && $t[$i]->type === 'word' && $t[$i]->upper() === 'CONCURRENTLY') {
            $i++;
        }
        if (isset($t[$i + 1]) && $t[$i]->type === 'word' && $t[$i]->upper() === 'IF' && $t[$i + 1]->type === 'word' && $t[$i + 1]->upper() === 'EXISTS') {
            $i += 2;
        }

        return self::nameList($t, $i);
    }

    /** @param list<Token> $t */
    private static function truncateTarget(array $t): ?string
    {
        $i = 1;
        if (isset($t[$i]) && $t[$i]->type === 'word' && $t[$i]->upper() === 'TABLE') {
            $i++;
        }

        return self::nameList($t, $i);
    }

    /**
     * Comma-separated (possibly dotted) object names starting at $i, joined as "a, b".
     * Tolerates ONLY before a name, "*" after one and a function argument list.
     *
     * @param  list<Token>  $t
     */
    private static function nameList(array $t, int $i): ?string
    {
        $names = [];
        while (true) {
            if (isset($t[$i]) && $t[$i]->type === 'word' && $t[$i]->upper() === 'ONLY' && isset($t[$i + 1]) && in_array($t[$i + 1]->type, ['word', 'quoted'], true)) {
                $i++;
            }
            $parts = [];
            $dangling = false;
            while (isset($t[$i]) && ($t[$i]->type === 'word' || $t[$i]->type === 'quoted')) {
                $parts[] = $t[$i]->identifier();
                $i++;
                $dangling = false;
                if (isset($t[$i]) && self::isPunct($t[$i], '.')) {
                    $i++;
                    $dangling = true;

                    continue;
                }
                break;
            }
            // An element after a comma (or a dotted part) that is not a plain name (e.g. MySQL's 2t or $t) means the
            // statement names objects this parser cannot read: fail closed.
            if ($parts === [] || $dangling) {
                return null;
            }
            $names[] = implode('.', $parts);
            if (isset($t[$i]) && self::isPunct($t[$i], '(')) {
                $i = self::skipGroup($t, $i);
            }
            if (isset($t[$i]) && self::isPunct($t[$i], '*')) {
                $i++;
            }
            if (isset($t[$i]) && self::isPunct($t[$i], ',')) {
                $i++;

                continue;
            }
            break;
        }

        return implode(', ', $names);
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
