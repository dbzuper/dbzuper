<?php

namespace App\Transfers\Native;

use App\Enums\TransferMethod;
use App\Models\SavedConnection;
use App\Transfers\Import\RestoreFailed;
use App\Transfers\Import\RestoreFilter;
use App\Transfers\Import\RestoreRefused;
use App\Transfers\Import\SqlPiece;
use App\Transfers\Import\SqlStream;
use App\Transfers\Io\DumpReader;
use App\Transfers\TransferCancelled;
use App\Transfers\TransferProgress;
use Generator;

/**
 * Restores with mysql / mariadb / psql (spec §3 "Native restore"). The client never reads the file itself: it gets
 * the dump through RestoreFilter (so USE / \connect / CREATE DATABASE can't leave the open database), re-serialised
 * piece by piece into its stdin. Input is produced only when the client has taken the previous chunk, so about one
 * chunk is in memory whatever the file size. Client commands (psql meta commands other than \connect / \restrict,
 * mysql `system` / `source` / `\!`…) refuse the file: a dump must not run shell commands or touch files.
 *
 * psql runs with --single-transaction and ON_ERROR_STOP: a failure or a cancel (the process is killed) rolls the
 * whole restore back. The mysql client stops at the first error; what ran before it stays.
 */
final class NativeRestorer
{
    /**
     * Bytes of serialised SQL handed to the client at a time (COPY data is cut into pieces of this size too). Small
     * enough that the input never runs far ahead of the client: a cancel must land before the end of input, or psql
     * sees end of file and commits.
     */
    private const CHUNK_BYTES = 262_144;

    /**
     * @return int statements sent
     *
     * @throws RestoreFailed
     * @throws RestoreRefused
     * @throws TransferCancelled
     */
    public function run(SavedConnection $c, ToolCheck $t, DumpReader $r, TransferProgress $p): int
    {
        if ($c->read_only) {
            throw new RestoreRefused('This connection is read-only.');
        }

        $count = 0;
        $chunks = $this->chunks($c, $t, $r, $p, $count);
        $command = NativeCommandBuilder::restore($c, $t);

        try {
            // The first chunk is read before the client starts, so a file refused at its start never reaches it.
            $chunks->valid();
            $started = false;
            // Called each time the client has taken the previous chunk. An exception thrown here (a cancel, a refused
            // statement, an unreadable file) kills the client before its stdin closes, so psql never sees the end of
            // input it would COMMIT on.
            $input = function () use ($chunks, &$started): ?string {
                if ($started) {
                    $chunks->next();
                }
                $started = true;

                return $chunks->valid() ? $chunks->current() : null;
            };

            $process = new NativeProcess($command, $c->password !== null ? (string) $c->password : null);
            // stdout (results of SELECTs in the file) is discarded.
            $exit = $process->run(null, fn () => $p->checkCancelled(), $input);

            if ($exit !== 0) {
                throw new RestoreFailed(0, '', $process->stderr() ?: "{$t->tool} exited with code {$exit}.");
            }

            return $count;
        } finally {
            $command->cleanup();
        }
    }

    /**
     * Does this psql know \restrict / \unrestrict (added in 18.0, 17.6, 16.10, 15.14, 14.19 and 13.22)? Then the
     * dump's own lines pass through and psql refuses any meta command between them; older ones would fail on them.
     */
    public static function knowsRestrict(ToolCheck $t): bool
    {
        if ($t->tool !== 'psql') {
            return false;
        }
        $version = (string) $t->version;
        $major = (int) $version;
        $fixed = [17 => '17.6', 16 => '16.10', 15 => '15.14', 14 => '14.19', 13 => '13.22'];

        return $major >= 18 || (isset($fixed[$major]) && version_compare($version, $fixed[$major], '>='));
    }

    /** One piece as the native client reads it. */
    public static function text(SqlPiece $piece): string
    {
        return match ($piece->kind) {
            'sql' => $piece->text.(self::endsInLineComment($piece->text) ? "\n" : '').$piece->delimiter."\n",
            'meta' => $piece->text."\n",
            'copy_data' => $piece->text,
            'delimiter' => 'DELIMITER '.$piece->text."\n",
        };
    }

    /**
     * Serialised pieces in chunks of about CHUNK_BYTES, reporting progress by file position as pieces are read.
     *
     * @return Generator<int, string>
     */
    private function chunks(SavedConnection $c, ToolCheck $t, DumpReader $r, TransferProgress $p, int &$count): Generator
    {
        $filter = new RestoreFilter($c->driver, (string) $c->database, TransferMethod::Native, self::knowsRestrict($t));
        $position = $r->position();
        $buffer = '';

        foreach ($filter->apply(SqlStream::pieces($r, $c->driver->value, copyPieceBytes: self::CHUNK_BYTES)) as $piece) {
            // Input is produced while the client runs; a cancel thrown here kills it (see NativeProcess::run()).
            $p->checkCancelled();
            $buffer .= self::text($piece);
            $statement = $piece->kind === 'sql' ? 1 : 0;
            $count += $statement;

            $now = $r->position();
            $p->advance(bytes: $now - $position, statements: $statement);
            $position = $now;

            if (strlen($buffer) >= self::CHUNK_BYTES) {
                yield $buffer;
                $buffer = '';
            }
        }

        if ($r->position() > $position) {
            $p->advance(bytes: $r->position() - $position);
        }
        if ($buffer !== '') {
            yield $buffer;
        }
    }

    /**
     * Does the statement's last line hold a `--` or `#` comment? Then a delimiter appended to it would be commented
     * out, so it goes on a line of its own. (A `--` or `#` inside a string literal only costs a harmless newline.)
     */
    private static function endsInLineComment(string $sql): bool
    {
        $last = strrchr($sql, "\n");
        $line = $last === false ? $sql : $last;

        return str_contains($line, '--') || str_contains($line, '#');
    }
}
