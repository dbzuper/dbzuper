<?php

namespace App\Transfers\Import;

use App\Enums\DriverName;
use App\Enums\TransferMethod;
use Generator;

/**
 * Sits between SqlStream and the restorers and enforces "a restore always goes into the open database".
 *
 * Removed: USE / psql \connect (remembered as the file's database target), CREATE DATABASE and DROP DATABASE
 * on every server engine, CREATE SCHEMA and DROP SCHEMA on MySQL/MariaDB only (there a schema is a database; on
 * PostgreSQL schemas are real objects and stay), transaction control on PostgreSQL and SQLite (the restorer owns
 * the transaction; SAVEPOINT/RELEASE stay), and psql \restrict / \unrestrict.
 *
 * Two different targets refuse the file. Names compare exactly, except on MySQL/MariaDB (case-insensitive). A
 * \connect that names no database (`\connect`, `\connect -`, options only) is ignored. A \connect whose database
 * can't be parsed is ignored too, unless a target was already seen: then it counts as a different, unnamed
 * database. Leading and trailing plain comments and whitespace are skipped when classifying a statement. On
 * MySQL/MariaDB a statement that is entirely one executable comment (slash-star-bang NNNNN or M!NNNNNN, as in
 * mysqldump --add-drop-database) is classified by its inner text; if that is not removable the piece passes.
 * ALTER DATABASE (and MySQL ALTER SCHEMA) and PostgreSQL COMMENT ON DATABASE are removed and count as targets;
 * a nameless MySQL ALTER DATABASE (CHARACTER SET ..., acts on the open database) passes.
 *
 * Built-in method: any psql meta line other than the ones above, a COPY … FROM stdin statement and any COPY data
 * refuse the file (the statement refuses before it can run; a run of copy_data pieces refuses at its first piece). Native method: they pass through. Delimiter pieces always pass.
 */
final class RestoreFilter
{
    private const NAME = '(?:`((?:[^`]|``)+)`|"((?:[^"]|"")+)"|([^\s;`"\/*]+))';

    /** mysql / mariadb client commands (long forms) that a native restore refuses to pass to the client. */
    private const MYSQL_CLIENT_COMMANDS = 'system|source|tee|notee|pager|nopager|edit|prompt|connect|charset|warnings|nowarnings|rehash|resetconnection|query_attributes|ssl_session_data_print|exit|quit|go|ego|print|status|help';

    private ?string $firstTarget = null;

    public function __construct(
        public readonly DriverName $driver,
        public readonly string $targetDatabase,
        public readonly TransferMethod $method,
        /** Native PostgreSQL: pass \restrict / \unrestrict to a psql that knows them (else they are removed). */
        public readonly bool $keepRestrict = false,
    ) {}

    /**
     * @param  iterable<SqlPiece>  $pieces
     * @return Generator<SqlPiece>
     */
    public function apply(iterable $pieces): Generator
    {
        foreach ($pieces as $piece) {
            $keep = match ($piece->kind) {
                'sql' => $this->keepSql($piece->text),
                'meta' => $this->keepMeta($piece->text),
                'copy_data' => $this->keepCopyData(),
                default => true,
            };

            if ($keep) {
                yield $piece;
            }
        }
    }

    private function isMySql(): bool
    {
        return $this->driver === DriverName::MySql || $this->driver === DriverName::MariaDb;
    }

    private function keepSql(string $text): bool
    {
        $sql = $this->stripComments($text);

        if ($this->method === TransferMethod::Native) {
            $this->refuseClientCommands($text, $sql);
        }

        // Executable comments (/*!NNNNN ...*/, /*M!NNNNNN ...*/) in front: a whole-statement one is classified by
        // its inner text; one followed by more text (MariaDB's sandbox marker line) is dropped for classification.
        while ($this->isMySql() && preg_match('~^/\*M?!\d*\s*((?:(?!\*/).)*)\*/(.*)$~s', $sql, $m) === 1) {
            $rest = $this->stripComments($m[2]);
            $sql = $rest === '' ? $this->stripComments($m[1]) : $rest;

            if ($rest === '') {
                break;
            }
        }

        // Its rows follow as copy_data, which only psql can feed; refuse before the statement runs and fails.
        // COPY (query) TO … is not a COPY FROM stdin, whatever its query's strings say.
        if ($this->method === TransferMethod::Builtin
            && preg_match('/^COPY\s+(?!\()(?:[^\'"]|"(?:[^"]|"")*")*?\bFROM\s+stdin\b/is', $sql) === 1) {
            throw new RestoreRefused($this->psqlOnly());
        }

        return ! $this->removable($sql);
    }

    /** True (after recording any database it names) when the statement must not reach the restorer. */
    private function removable(string $sql): bool
    {
        $name = self::NAME;

        if (preg_match("/^USE\\s+{$name}\\s*\$/i", $sql, $m) === 1) {
            $this->target($this->nameFrom($m));

            return true;
        }

        if ($this->driver !== DriverName::Sqlite) {
            $kind = $this->isMySql() ? '(?:DATABASE|SCHEMA)' : 'DATABASE';
            $create = "/^CREATE\\s+(?:OR\\s+REPLACE\\s+)?{$kind}\\s+(?:\\/\\*!\\d+\\s*IF\\s+NOT\\s+EXISTS\\s*\\*\\/\\s*|IF\\s+NOT\\s+EXISTS\\s+)?{$name}/i";
            $drop = "/^DROP\\s+{$kind}\\s+(?:IF\\s+EXISTS\\s+)?{$name}/i";

            $alter = "/^ALTER\s+{$kind}\s+{$name}/i";
            $comment = "/^COMMENT\s+ON\s+DATABASE\s+{$name}/i";

            foreach ([$create, $drop, $alter, $comment] as $pattern) {
                if (preg_match($pattern, $sql, $m) === 1) {
                    // A nameless MySQL ALTER DATABASE CHARACTER SET ... acts on the open database.
                    if ($pattern === $alter && $this->isMySql() && ($m[3] ?? '') !== ''
                        && preg_match('/^(?:CHARACTER|CHARSET|DEFAULT|COLLATE|UPGRADE|COMMENT)$/i', $m[3]) === 1) {
                        continue;
                    }

                    $this->target($this->nameFrom($m));

                    return true;
                }
            }
        }

        if ($this->driver === DriverName::Postgres || $this->driver === DriverName::Sqlite) {
            $options = '(?:\s+(?:ISOLATION|READ|NOT|DEFERRABLE)\b.*)?';
            $begin = '/^(?:BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION)'.$options.'$/is';
            $end = '/^(?:COMMIT|END|ROLLBACK|ABORT)(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?$/i';

            if (preg_match($begin, $sql) === 1 || preg_match($end, $sql) === 1) {
                return true;
            }
        }

        return false;
    }

    private function keepMeta(string $text): bool
    {
        $line = trim($text);

        if (preg_match('/^\\\\(?:unrestrict|restrict)(?:\s|$)/', $line) === 1) {
            return $this->method === TransferMethod::Native && $this->keepRestrict;
        }

        if (preg_match('/^\\\\c(?:onnect)?(?:\s+(.*))?$/s', $line, $m) === 1) {
            $args = $m[1] ?? '';
            $db = $this->connectTarget($args);

            if ($db !== null) {
                $this->target($db);
            } elseif ($this->firstTarget !== null && ! $this->connectNamesNothing($args)) {
                $this->target(null);
            }

            return false;
        }

        if ($this->method === TransferMethod::Builtin) {
            throw new RestoreRefused($this->psqlOnly());
        }

        // Native: psql would run it. \! runs a shell, \o / \w write files, \i reads them, \setenv… none belong in a
        // dump (pg_dump writes only \connect and \restrict), so every other meta command refuses the file.
        throw new RestoreRefused($this->psqlCommands(self::metaName($line)));
    }

    /**
     * A statement must not smuggle client commands to the native client: on PostgreSQL a backslash outside
     * literals, quoted names, dollar quotes and comments (psql runs the \! of `SELECT 1 \! cmd`); on MySQL/MariaDB
     * a statement that is a client command (`system …`, `source …`, `\! …`). The clients' --binary-mode already
     * ignores client commands inside statements there.
     */
    private function refuseClientCommands(string $text, string $stripped): void
    {
        if ($this->driver === DriverName::Postgres) {
            $command = self::psqlCommandIn($text);
            if ($command !== null) {
                throw new RestoreRefused($this->psqlCommands($command));
            }

            return;
        }

        if ($this->isMySql() && preg_match('/^(?:\\\\(\S?)|('.self::MYSQL_CLIENT_COMMANDS.')(?=\s|;|$))/i', $stripped, $m) === 1) {
            $name = ($m[2] ?? '') !== '' ? strtolower($m[2]) : '\\'.$m[1];

            throw new RestoreRefused("This file contains mysql client commands DBZuper won't run ({$name}). Remove them or restore with the built-in method.");
        }
    }

    /** The psql command a backslash outside quotes and comments starts, or null when there is none. */
    private static function psqlCommandIn(string $sql): ?string
    {
        $n = strlen($sql);
        for ($i = 0; $i < $n; $i++) {
            $c = $sql[$i];
            $next = $sql[$i + 1] ?? '';

            if ($c === '\\') {
                return self::metaName(substr($sql, $i));
            }
            if ($c === '-' && $next === '-') {
                $end = strpos($sql, "\n", $i);
                $i = $end === false ? $n : $end;
            } elseif ($c === '/' && $next === '*') {
                // Nested, as in PostgreSQL and psql.
                $depth = 1;
                $i += 2;
                while ($i < $n && $depth > 0) {
                    $pair = substr($sql, $i, 2);
                    if ($pair === '/*') {
                        $depth++;
                        $i += 2;
                    } elseif ($pair === '*/') {
                        $depth--;
                        $i += 2;
                    } else {
                        $i++;
                    }
                }
                $i--;
            } elseif ($c === "'") {
                // E'…' takes backslash escapes, a standard string only ''. Where psql would read a string as longer
                // (standard_conforming_strings off) this one ends earlier, which can only over-refuse.
                $escapes = $i > 0 && ($sql[$i - 1] === 'E' || $sql[$i - 1] === 'e') && ($i < 2 || preg_match('/\w/', $sql[$i - 2]) !== 1);
                for ($i++; $i < $n; $i++) {
                    if ($escapes && $sql[$i] === '\\') {
                        $i++;
                    } elseif ($sql[$i] === "'") {
                        if (($sql[$i + 1] ?? '') !== "'") {
                            break;
                        }
                        $i++;
                    }
                }
            } elseif ($c === '"') {
                $end = strpos($sql, '"', $i + 1);
                $i = $end === false ? $n : $end;
            } elseif ($c === '$' && ($i === 0 || preg_match('/[\w$]/', $sql[$i - 1]) !== 1)
                && preg_match('/\G\$(?:[A-Za-z_\x80-\xff][\w\x80-\xff]*)?\$/', $sql, $m, 0, $i) === 1) {
                $end = strpos($sql, $m[0], $i + strlen($m[0]));
                $i = $end === false ? $n : $end + strlen($m[0]) - 1;
            }
        }

        return null;
    }

    /** `\!echo x` → `\!`, `\lo_import f` → `\lo_import`. */
    private static function metaName(string $line): string
    {
        return preg_match('/^\\\\([A-Za-z_]+|.)/s', ltrim($line), $m) === 1 ? '\\'.$m[1] : '\\';
    }

    private function psqlCommands(string $name): string
    {
        return "This file contains psql commands DBZuper won't run ({$name}). Remove them or restore with the built-in method.";
    }

    private function keepCopyData(): bool
    {
        if ($this->method === TransferMethod::Builtin) {
            throw new RestoreRefused($this->psqlOnly());
        }

        return true;
    }

    private function psqlOnly(): string
    {
        return 'This file uses psql-only commands (COPY … FROM stdin); restore it with the native method (needs psql)';
    }

    /** Record a target; null stands for an unparseable \connect that follows a named target. */
    private function target(?string $name): void
    {
        if ($this->firstTarget === null) {
            $this->firstTarget = $name;

            return;
        }

        if ($name === null || ! $this->sameName($this->firstTarget, $name)) {
            $other = $name ?? 'another database';

            throw new RestoreRefused("This file restores more than one database ({$this->firstTarget} and {$other}). Restore one database per file.");
        }
    }

    private function sameName(string $a, string $b): bool
    {
        return $this->isMySql() ? mb_strtolower($a) === mb_strtolower($b) : $a === $b;
    }

    /**
     * The unquoted name out of the three NAME capture groups (backtick, double quote, bare) at 1..3.
     *
     * @param  array<int|string, string>  $m
     */
    private function nameFrom(array $m): string
    {
        if (($m[1] ?? '') !== '') {
            return str_replace('``', '`', $m[1]);
        }

        if (($m[2] ?? '') !== '') {
            return str_replace('""', '"', $m[2]);
        }

        return $m[3] ?? '';
    }

    /** The database named by a \connect argument list: first non-option argument, or its dbname=... part. */
    private function connectTarget(string $args): ?string
    {
        foreach ($this->psqlArguments($args) as [$value, $quoted]) {
            if (! $quoted && str_starts_with($value, '-')) {
                continue;
            }

            if (preg_match('~^postgres(?:ql)?://~i', $value) === 1) {
                $url = parse_url($value);
                $path = rawurldecode(ltrim($url['path'] ?? '', '/'));
                parse_str($url['query'] ?? '', $query);
                $name = $path !== '' ? $path : ($query['dbname'] ?? '');

                return is_string($name) && $name !== '' ? $name : null;
            }

            if (preg_match("/(?:^|\\s)dbname\\s*=\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|(\\S+))/", $value, $m) === 1) {
                $name = $m[1] !== '' ? stripslashes($m[1]) : ($m[2] ?? '');

                return $name !== '' ? $name : null;
            }

            if (str_contains($value, '=')) {
                return null;
            }

            return $value !== '' ? $value : null;
        }

        return null;
    }

    /** `\connect`, `\connect -` and `\connect -reuse-previous=on` stay on the current database. */
    private function connectNamesNothing(string $args): bool
    {
        foreach ($this->psqlArguments($args) as [$value, $quoted]) {
            if ($quoted || ! str_starts_with($value, '-')) {
                return false;
            }
        }

        return true;
    }

    /** @return list<array{string, bool}> [value, wasQuoted] */
    private function psqlArguments(string $args): array
    {
        preg_match_all('/"((?:[^"]|"")*)"|\'((?:[^\']|\'\')*)\'|(\S+)/', $args, $all, PREG_SET_ORDER);

        $out = [];
        foreach ($all as $m) {
            if (isset($m[3])) {
                $out[] = [$m[3], false];
            } elseif (str_starts_with($m[0], "'")) {
                $out[] = [str_replace("''", "'", $m[2] ?? ''), true];
            } else {
                $out[] = [str_replace('""', '"', $m[1] ?? ''), true];
            }
        }

        return $out;
    }

    private function stripComments(string $sql): string
    {
        $line = $this->isMySql() ? '(?:--(?=\s|$)|#)' : '--';
        $plain = '/\*(?!M?!)(?:(?!\*/).)*\*/';

        // Plain comments only: an executable comment (slash-star-bang) is a statement of its own and stays.
        $sql = preg_replace('~^(?:\s+|'.$plain.'|'.$line.'[^\n]*(?:\n|$))+~s', '', $sql) ?? $sql;

        do {
            $before = $sql;
            $sql = preg_replace('~(?:\s+|'.$plain.'|'.$line.'[^\n]*)$~s', '', $sql) ?? $sql;
            $sql = rtrim($sql, " \t\r\n;");
        } while ($sql !== $before);

        return $sql;
    }
}
