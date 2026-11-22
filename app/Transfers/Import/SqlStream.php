<?php

namespace App\Transfers\Import;

use App\Transfers\Io\DumpReader;
use Generator;
use RuntimeException;

/**
 * Streaming statement splitter for dump files of any size.
 *
 * Statement boundaries follow SqlLexer's rules exactly (strings, quoted identifiers, comments, PostgreSQL dollar
 * quotes and E'' strings, MySQL backslash escapes and `--` spacing). The scan does not build Token objects,
 * though: a 20 MB INSERT has millions of tokens and materialising them costs many times the statement's own
 * size. Instead a per-dialect regex skips runs of ordinary tokens inside PCRE, and only strings, comments and
 * terminators are handled in PHP. SqlStreamTest checks the result against SqlLexer on random input.
 *
 * Buffering: the buffer holds the unread rest of the file's current statement. When it holds no terminator yet,
 * it is not rescanned until it has doubled in size (or the file ends). One huge statement therefore costs O(n)
 * scanning in total rather than O(n² / chunk), and the buffer stays under about twice the statement's size.
 *
 * Differences from SqlSplitter: comments before a statement are dropped (so a psql meta line or a DELIMITER line
 * after a dump's header comments is still at a statement start), trailing whitespace is trimmed, and MySQL
 * executable comments (`/*!…*\/`, plus `/*M!…*\/` on MariaDB) count as statement text.
 */
final class SqlStream
{
    private const WHITESPACE = " \t\n\r\f\x0B";

    private const COPY_FROM_STDIN = '/^\s*COPY\b.*\bFROM\s+stdin\b(.*)$/is';

    /** Bytes that must follow a custom delimiter before it is trusted (the lexer never looks further ahead). */
    private const LOOKAHEAD = 3;

    private string $buffer = '';

    /** Start of the unread part of $buffer. */
    private int $pos = 0;

    private bool $eof = false;

    /** Unread bytes needed before extract() is worth calling again. */
    private int $need = 0;

    private string $delimiter = ';';

    private int $number = 0;

    /** Null outside COPY data, -1 before the end of the COPY line, else data bytes already searched for `\.`. */
    private ?int $copyScanned = null;

    /** Whether the current COPY block is CSV. */
    private bool $copyCsv = false;

    private readonly bool $mysql;

    private readonly bool $mariadb;

    private readonly bool $pg;

    private readonly bool $sqlite;

    /**
     * Skips ordinary tokens plus complete strings, quoted identifiers and simple comments; stops at ';' and at
     * anything left to PHP (unterminated or E'' strings, PostgreSQL block comments, dollar quotes).
     */
    private readonly string $fastSemicolon;

    /** For a custom delimiter: skips ordinary tokens (';' is one); stops at every string, comment or dollar quote. */
    private readonly string $plainCustom;

    private function __construct(string $dialect, private readonly int $copyPieceBytes)
    {
        $this->mariadb = $dialect === 'mariadb';
        $this->mysql = $dialect === 'mysql' || $this->mariadb;
        $this->pg = $dialect === 'pgsql';
        $this->sqlite = $dialect === 'sqlite';

        // Bytes that may start a non-ordinary token. Only '$' (PostgreSQL) can also sit inside a word, so there
        // words are matched whole, mirroring SqlLexer's word rule.
        $special = '\'"`\-\/'.match ($dialect) {
            'mysql', 'mariadb' => '#',
            'pgsql' => '$A-Za-z_\x80-\xff',
            'sqlite' => '\[',
            default => '',
        };
        $ordinary = ['-(?!-'.($this->mysql ? '(?:[\x00-\x20]|\z)' : '').')', '\/(?!\*)'];
        if ($this->pg) {
            $ordinary[] = '[A-Za-z_\x80-\xff][A-Za-z0-9_$\x80-\xff]*+';
            $ordinary[] = '\$(?!(?:[A-Za-z_][A-Za-z0-9_]*+)?\$)';
        }

        // Complete tokens SqlLexer would read the same way, whatever follows them. Each is one possessive
        // character-class run with no repeated group, so PCRE work and backtrack state stay constant per token
        // however long it is. A string with an escape or a doubled quote does not match: PHP's quoteEnd() finishes
        // it in linear time. A line comment needs its newline so it cannot continue into the next chunk.
        $complete = $this->mysql ? [
            '\'[^\'\\\\]*+\'(?!\')',
            '"[^"\\\\]*+"(?!")',
            '#[^\n]*+(?=\n)',
            '--(?=[\x00-\x20])[^\n]*+(?=\n)',
        ] : [
            // A PostgreSQL E'' string (E not preceded by a word character) takes backslash escapes: left to PHP.
            ($this->pg ? '(?:(?<![Ee])|(?<=[A-Za-z0-9_$\x80-\xff][Ee]))' : '').'\'[^\']*+\'(?!\')',
            '"[^"]*+"(?!")',
            $this->pg ? '--[^\r\n]*+(?=[\r\n])' : '--[^\n]*+(?=\n)',
        ];
        $complete[] = '`[^`]*+`(?!`)';
        if ($dialect === 'sqlite') {
            $complete[] = '\[[^\]]*+\]';
        }

        // A bounded repeat keeps each call under pcre.backtrack_limit on huge input (unbounded, 5M tokens fail);
        // PCRE expands the count when compiling, so it stays small and skipPlain() loops.
        $tail = '){0,100}+\K/';
        $this->fastSemicolon = '/\G(?:[^;'.$special.']++|'.implode('|', [...$complete, ...$ordinary]).$tail;
        $this->plainCustom = '/\G(?:[^'.$special.']++|'.implode('|', $ordinary).$tail;
    }

    /**
     * Statements, psql meta lines, COPY data and DELIMITER lines of a dump, in file order. One COPY block arrives
     * as one or more consecutive copy_data pieces of whole lines (at most about $copyPieceBytes each).
     *
     * @return Generator<int, SqlPiece>
     */
    public static function pieces(
        DumpReader $reader,
        string $dialect,
        int $chunkBytes = 4_194_304,
        int $copyPieceBytes = 4_194_304,
    ): Generator {
        yield from (new self($dialect, max(1, $copyPieceBytes)))->run($reader, max(1, $chunkBytes));
    }

    /** @return Generator<int, SqlPiece> */
    private function run(DumpReader $reader, int $chunkBytes): Generator
    {
        while (true) {
            if ($this->eof || strlen($this->buffer) - $this->pos >= $this->need) {
                $piece = $this->extract();
                if ($piece !== null) {
                    $this->need = 0;
                    yield $piece;

                    continue;
                }
                if ($this->eof) {
                    return;
                }
            }

            if ($this->pos > 0) {
                $this->buffer = substr($this->buffer, $this->pos);
                $this->pos = 0;
            }
            $chunk = $reader->read($chunkBytes);
            if ($chunk === null) {
                $this->eof = true;
            } else {
                $this->buffer .= $chunk;
            }
        }
    }

    /** The next piece, or null when more input is needed (or, at end of file, when nothing is left). */
    private function extract(): ?SqlPiece
    {
        if ($this->copyScanned !== null) {
            return $this->copyData();
        }

        while (true) {
            if (! $this->skipLeading()) {
                return $this->wait();
            }
            $len = strlen($this->buffer);
            if ($this->pos >= $len) {
                return $this->wait();
            }

            if ($this->mysql) {
                $piece = $this->delimiterLine();
                if ($piece !== false) {
                    return $piece ?? $this->wait();
                }
            }
            if ($this->pg && $this->buffer[$this->pos] === '\\') {
                return $this->metaLine() ?? $this->wait();
            }

            $start = $this->pos;
            $end = $this->terminator($start);
            if ($end === null) {
                if (! $this->eof) {
                    return $this->wait();
                }
                $text = substr($this->buffer, $start);
                $this->pos = $len;
            } else {
                $text = substr($this->buffer, $start, $end - $start);
                $this->pos = $end + strlen($this->delimiter);
            }

            $text = rtrim($text, self::WHITESPACE);
            if ($text === '') {
                continue; // an empty statement
            }
            $this->number++;
            if ($this->pg && preg_match(self::COPY_FROM_STDIN, $text, $copy) === 1) {
                $this->copyScanned = -1;
                $this->copyCsv = preg_match('/\bcsv\b/i', $copy[1]) === 1;
            }

            return new SqlPiece('sql', $text, $this->delimiter, $this->number);
        }
    }

    /** Re-scan once the unread part has doubled, so a long statement is scanned O(n) times in total. */
    private function wait(): null
    {
        $unread = strlen($this->buffer) - $this->pos;
        $this->need = max($unread + 1, 2 * $unread);

        return null;
    }

    /**
     * Moves past whitespace and plain comments at a statement start. True when $pos is at the statement's first
     * byte (or the buffer's end); false when more input is needed to tell.
     */
    private function skipLeading(): bool
    {
        $b = $this->buffer;
        $len = strlen($b);
        $i = $this->pos;

        while (true) {
            $i += strspn($b, self::WHITESPACE, $i);
            $this->pos = $i;
            if ($i >= $len) {
                return true;
            }

            $c = $b[$i];
            $next = $b[$i + 1] ?? null;
            if (($c === '-' || $c === '/') && $next === null) {
                return $this->eof; // the next byte decides whether a comment starts here
            }

            if ($c === '-' && $next === '-') {
                if ($this->mysql && $i + 2 >= $len && ! $this->eof) {
                    return false;
                }
                if ($this->mysql && $i + 2 < $len && ord($b[$i + 2]) > 32) {
                    return true;
                }
                $end = $this->lineCommentEnd($b, $i);
            } elseif ($c === '#' && $this->mysql) {
                $end = $this->lineCommentEnd($b, $i);
            } elseif ($c === '/' && $next === '*') {
                if ($this->mysql) {
                    $executable = $this->executable($b, $i);
                    if ($executable !== false) {
                        return $executable === true;
                    }
                }
                $end = $this->blockCommentEnd($b, $i);
            } else {
                return true;
            }

            if ($end >= $len && ! $this->eof) {
                return false;
            }
            $i = $end;
        }
    }

    /** Whether the block comment at $i is MySQL/MariaDB executable code; null when more input is needed. */
    private function executable(string $b, int $i): ?bool
    {
        $third = $b[$i + 2] ?? null;
        if ($third === '!') {
            return true;
        }
        if ($third === null || ($this->mariadb && $third === 'M' && ! isset($b[$i + 3]))) {
            return $this->eof ? false : null;
        }

        return $this->mariadb && $third === 'M' && $b[$i + 3] === '!';
    }

    /** A `DELIMITER x` line at $pos; false when there is none, null when more input is needed. */
    private function delimiterLine(): SqlPiece|false|null
    {
        $b = $this->buffer;
        $i = $this->pos;
        $head = substr($b, $i, 10);
        if (preg_match('/^DELIMITER[ \t]/i', $head) !== 1) {
            $partial = ! $this->eof && strlen($head) < 10 && strncasecmp($head, 'DELIMITER', strlen($head)) === 0;

            return $partial ? null : false;
        }

        $newline = $this->lineEnd($b, $i);
        if ($newline === null) {
            return null;
        }
        // Like the mysql client: the delimiter is the first word; anything after it (a comment) is ignored.
        $words = preg_split('/[ \t\r\f\x0B]+/', trim(substr($b, $i + 10, $newline - $i - 10), self::WHITESPACE));
        $delimiter = $words === false ? '' : $words[0];
        if ($delimiter === '') {
            throw new RuntimeException('DELIMITER must be followed by a delimiter.');
        }
        $this->pos = min($newline + 1, strlen($b));
        $this->delimiter = $delimiter;

        return new SqlPiece('delimiter', $delimiter, $delimiter);
    }

    /** The psql backslash line at $pos; null when more input is needed. */
    private function metaLine(): ?SqlPiece
    {
        $b = $this->buffer;
        $i = $this->pos;
        $newline = $this->lineEnd($b, $i);
        if ($newline === null) {
            return null;
        }
        $this->pos = min($newline + 1, strlen($b));

        return new SqlPiece('meta', rtrim(substr($b, $i, $newline - $i), "\r"), $this->delimiter);
    }

    /** Offset of the "\n" ending the line at $i (the buffer's end at end of file); null when more input is needed. */
    private function lineEnd(string $b, int $i): ?int
    {
        $newline = strpos($b, "\n", $i);
        if ($newline !== false) {
            return $newline;
        }

        return $this->eof ? strlen($b) : null;
    }

    /** Offset of the terminator of the statement starting at $start, or null when the buffer holds none. */
    private function terminator(int $start): ?int
    {
        $b = $this->buffer;
        $len = strlen($b);
        $custom = $this->delimiter !== ';';
        $regex = $custom ? $this->plainCustom : $this->fastSemicolon;
        $width = strlen($this->delimiter);
        $i = $start;
        $gap = $start;   // start of the current run of ordinary tokens
        $next = -1;      // first delimiter occurrence at or after $gap (custom delimiter only)
        // SQLite has no DELIMITER: like sqlite3_complete(), a CREATE TRIGGER statement ends only at "END ;".
        $trigger = $this->sqlite
            && preg_match('/\GCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i', $b, $m, 0, $start) === 1;

        while (true) {
            $i = $this->skipPlain($regex, $b, $i);

            if ($custom) {
                if ($next < $gap) {
                    $found = strpos($b, $this->delimiter, $gap);
                    $next = $found === false ? PHP_INT_MAX : $found;
                }
                if ($next <= $i - $width) {
                    return $next + $width + self::LOOKAHEAD <= $len || $this->eof ? $next : null;
                }
            }

            if ($i >= $len) {
                return null;
            }
            if (! $custom && $b[$i] === ';') {
                if (! $trigger || $this->afterEnd($b, $start, $i)) {
                    return $i;
                }
                $i++; // a ';' inside a SQLite trigger body

                continue;
            }
            $i = $this->tokenEnd($b, $i, $start);
            if ($i >= $len) {
                return null; // unterminated, or it might continue (a closing quote could be doubled)
            }
            $gap = $i;
        }
    }

    /**
     * Whether the last token before the ';' at $semicolon is the keyword END (whitespace between them allowed). The
     * ';' is outside strings and comments, so trailing END word characters can only be an END word token.
     */
    private function afterEnd(string $b, int $start, int $semicolon): bool
    {
        $j = $semicolon;
        while ($j > $start && str_contains(self::WHITESPACE, $b[$j - 1])) {
            $j--;
        }

        return $j - 3 >= $start && strcasecmp(substr($b, $j - 3, 3), 'END') === 0
            && ($j - 4 < $start || preg_match('/[A-Za-z0-9_$\x80-\xff]/', $b[$j - 4]) !== 1);
    }

    private function skipPlain(string $regex, string $b, int $i): int
    {
        $len = strlen($b);
        while ($i < $len) {
            if (preg_match($regex, $b, $m, PREG_OFFSET_CAPTURE, $i) !== 1) {
                throw new RuntimeException('Cannot scan the SQL text: '.preg_last_error_msg());
            }
            $end = $m[0][1];
            if ($end === $i) {
                break;
            }
            $i = $end;
        }

        return $i;
    }

    /** End of the string, quoted identifier, comment or dollar quote starting at $i. */
    private function tokenEnd(string $b, int $i, int $start): int
    {
        $c = $b[$i];

        return match ($c) {
            '-', '#' => $this->lineCommentEnd($b, $i),
            '/' => $this->blockCommentEnd($b, $i),
            '$' => $this->dollarEnd($b, $i),
            default => $this->quoteEnd($b, $i, $c, $start),
        };
    }

    private function lineCommentEnd(string $b, int $i): int
    {
        // PostgreSQL line comments also end at a bare carriage return.
        return $i + strcspn($b, $this->pg ? "\r\n" : "\n", $i);
    }

    private function blockCommentEnd(string $b, int $i): int
    {
        $len = strlen($b);
        if (! $this->pg) {
            $close = strpos($b, '*/', $i + 2);

            return $close === false ? $len : $close + 2;
        }

        // PostgreSQL block comments nest.
        $depth = 1;
        $j = $i + 2;
        while ($depth > 0) {
            $close = strpos($b, '*/', $j);
            if ($close === false) {
                return $len;
            }
            $open = strpos($b, '/*', $j);
            if ($open !== false && $open < $close) {
                $depth++;
                $j = $open + 2;
            } else {
                $depth--;
                $j = $close + 2;
            }
        }

        return $j;
    }

    private function dollarEnd(string $b, int $i): int
    {
        if (preg_match('/\G\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/', $b, $m, 0, $i) !== 1) {
            return $i + 1; // a lone '$' is punctuation (the scan only stops here at a tag, so this is defensive)
        }
        $tag = $m[0];
        $close = strpos($b, $tag, $i + strlen($tag));

        return $close === false ? strlen($b) : $close + strlen($tag);
    }

    private function quoteEnd(string $b, int $i, string $open, int $start): int
    {
        $len = strlen($b);
        $close = $open === '[' ? ']' : $open;
        // Bytes before $start belong to an earlier statement and are never word characters.
        $ePrefix = $this->pg && $open === "'" && $i - 1 >= $start && ($b[$i - 1] === 'E' || $b[$i - 1] === 'e')
            && ($i - 2 < $start || preg_match('/[A-Za-z0-9_$\x80-\xff]/', $b[$i - 2]) !== 1);
        $backslash = ($this->mysql && ($open === "'" || $open === '"')) || $ePrefix;
        $stops = $backslash ? $close.'\\' : $close;

        $j = $i + 1;
        while ($j < $len) {
            $j += strcspn($b, $stops, $j);
            if ($j >= $len) {
                break;
            }
            if ($b[$j] === '\\') {
                $j += 2;

                continue;
            }
            if ($close !== ']' && ($b[$j + 1] ?? '') === $close) {
                $j += 2;

                continue;
            }

            return $j + 1;
        }

        return $len;
    }

    /**
     * The next piece of the COPY data at $pos; null when more input is needed. A block is cut into pieces of whole
     * lines of at most $copyPieceBytes (unless one line is longer), so a huge table never sits in memory whole; the
     * last piece holds the `\.` line. Cuts fall right after a "\n", so a CRLF pair is never split across pieces.
     */
    private function copyData(): ?SqlPiece
    {
        $b = $this->buffer;
        $len = strlen($b);

        if ($this->copyScanned < 0) {
            $newline = strpos($b, "\n", $this->pos);
            if ($newline === false) {
                return $this->copyWait();
            }
            $rest = trim(substr($b, $this->pos, $newline - $this->pos), self::WHITESPACE);
            if ($rest !== '' && ! str_starts_with($rest, '--')) {
                throw new RuntimeException('Unexpected text after COPY … FROM stdin on the same line.');
            }
            $this->pos = $newline + 1;
            $this->copyScanned = 0;
        }

        $data = $this->pos;
        $terminator = $this->copyTerminator($b, $data);
        if ($terminator !== null && $this->copyPieceBytes >= $terminator[0] - $data) {
            $this->pos = $terminator[1];
            $this->copyScanned = null;

            return new SqlPiece('copy_data', $this->copyText(substr($b, $data, $terminator[0] - $data))."\\.\n", $this->delimiter);
        }
        if ($terminator === null && $this->eof) {
            throw new RuntimeException('Unterminated COPY data');
        }

        // Bytes before $safe are data lines: no terminator line starts there.
        $safe = $terminator[0] ?? $data + (int) $this->copyScanned;
        if ($safe - $data < $this->copyPieceBytes) {
            return $this->copyWait();
        }
        $limit = $data + $this->copyPieceBytes;
        $cut = strrpos($b, "\n", $limit - 1 - $len);
        if ($cut === false || $cut < $data) {
            $cut = strpos($b, "\n", $limit); // one line longer than a piece: cut at its end
            if ($cut === false || $cut >= $safe) {
                return $this->copyWait();
            }
        }
        $this->pos = $cut + 1;
        $this->copyScanned = max(0, (int) $this->copyScanned - ($cut + 1 - $data));

        return new SqlPiece('copy_data', $this->copyText(substr($b, $data, $cut + 1 - $data)), $this->delimiter);
    }

    /**
     * [offset of the `\.` line, offset after it] for the first terminator line at or after $data, or null when the
     * buffer holds none yet ($copyScanned then records where the search resumes).
     *
     * @return array{int, int}|null
     */
    private function copyTerminator(string $b, int $data): ?array
    {
        $len = strlen($b);
        $from = $data + (int) $this->copyScanned;
        while (($k = strpos($b, '\\.', $from)) !== false) {
            $from = $k + 1;
            if ($k > $data && $b[$k - 1] !== "\n") {
                continue;
            }
            $after = substr($b, $k + 2, 2);
            if ($after === '' || $after === "\r") {
                if (! $this->eof) {
                    $this->copyScanned = $k - $data; // the line might not end here

                    return null;
                }

                return [$k, $len];
            }
            if ($after[0] === "\n") {
                return [$k, $k + 3];
            }
            if ($after === "\r\n") {
                return [$k, $k + 4];
            }
        }
        $this->copyScanned = max(0, $len - 1 - $data);

        return null;
    }

    /** Text-format rows get LF line endings; CSV data passes through untouched (a CR may be data there). */
    private function copyText(string $rows): string
    {
        return $this->copyCsv ? $rows : str_replace("\r\n", "\n", $rows);
    }

    private function copyWait(): null
    {
        if ($this->eof) {
            throw new RuntimeException('Unterminated COPY data');
        }
        $this->need = strlen($this->buffer) - $this->pos + 1;

        return null;
    }
}
