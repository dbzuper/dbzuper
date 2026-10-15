<?php

namespace App\Database\Sql;

final class SqlLexer
{
    /** @return list<Token> */
    public static function tokenize(string $sql, string $dialect): array
    {
        $mysql = $dialect === 'mysql' || $dialect === 'mariadb';
        $pg = $dialect === 'pgsql';
        $len = strlen($sql);
        $tokens = [];
        $i = 0;

        while ($i < $len) {
            $c = $sql[$i];
            $n = $i + 1 < $len ? $sql[$i + 1] : '';

            if ($c === ' ' || $c === "\t" || $c === "\n" || $c === "\r" || $c === "\f" || $c === "\v") {
                $i++;

                continue;
            }

            // Line comments. MySQL requires whitespace/control (or end) after "--".
            $dashComment = $c === '-' && $n === '-' && (! $mysql || $i + 2 >= $len || ord($sql[$i + 2]) <= 32);
            if ($dashComment || ($mysql && $c === '#')) {
                // PostgreSQL line comments also end at a bare carriage return.
                $end = $i + ($pg ? strcspn($sql, "\r\n", $i) : strcspn($sql, "\n", $i));
                $tokens[] = new Token('comment', substr($sql, $i, $end - $i), $i, $end);
                $i = $end;

                continue;
            }

            if ($c === '/' && $n === '*') {
                $depth = 1;
                $j = $i + 2;
                while ($j < $len && $depth > 0) {
                    if ($pg && $sql[$j] === '/' && ($sql[$j + 1] ?? '') === '*') {
                        $depth++;
                        $j += 2;
                    } elseif ($sql[$j] === '*' && ($sql[$j + 1] ?? '') === '/') {
                        $depth--;
                        $j += 2;
                    } else {
                        $j++;
                    }
                }
                $j = min($j, $len);
                $tokens[] = new Token('comment', substr($sql, $i, $j - $i), $i, $j);
                $i = $j;

                continue;
            }

            if ($pg && $c === '$' && preg_match('/\G\$([A-Za-z_][A-Za-z0-9_]*)?\$/', $sql, $m, 0, $i)) {
                $tag = $m[0];
                $close = strpos($sql, $tag, $i + strlen($tag));
                $end = $close === false ? $len : $close + strlen($tag);
                $tokens[] = new Token('string', substr($sql, $i, $end - $i), $i, $end);
                $i = $end;

                continue;
            }

            if ($c === "'" || $c === '"' || $c === '`' || ($dialect === 'sqlite' && $c === '[')) {
                $close = $c === '[' ? ']' : $c;
                $ePrefix = $pg && $c === "'" && $i > 0 && ($sql[$i - 1] === 'E' || $sql[$i - 1] === 'e')
                    && ($i < 2 || ! preg_match('/[A-Za-z0-9_$\x80-\xff]/', $sql[$i - 2]));
                $backslash = ($mysql && ($c === "'" || $c === '"')) || $ePrefix;
                $j = $i + 1;
                while ($j < $len) {
                    if ($backslash && $sql[$j] === '\\') {
                        $j += 2;

                        continue;
                    }
                    if ($sql[$j] === $close) {
                        if ($close !== ']' && ($sql[$j + 1] ?? '') === $close) {
                            $j += 2;

                            continue;
                        }
                        $j++;
                        break;
                    }
                    $j++;
                }
                $j = min($j, $len);
                $type = ($c === "'" || ($mysql && $c === '"')) ? 'string' : 'quoted';
                $tokens[] = new Token($type, substr($sql, $i, $j - $i), $i, $j);
                $i = $j;

                continue;
            }

            if ($c === ';') {
                $tokens[] = new Token('semicolon', ';', $i, $i + 1);
                $i++;

                continue;
            }

            if (preg_match('/\G[0-9]+(\.[0-9]+)?/', $sql, $m, 0, $i)) {
                $tokens[] = new Token('number', $m[0], $i, $i + strlen($m[0]));
                $i += strlen($m[0]);

                continue;
            }

            if (preg_match('/\G[A-Za-z_\x80-\xff][A-Za-z0-9_$\x80-\xff]*/', $sql, $m, 0, $i)) {
                $tokens[] = new Token('word', $m[0], $i, $i + strlen($m[0]));
                $i += strlen($m[0]);

                continue;
            }

            $tokens[] = new Token('punct', $c, $i, $i + 1);
            $i++;
        }

        return $tokens;
    }
}
