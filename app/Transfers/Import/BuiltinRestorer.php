<?php

namespace App\Transfers\Import;

use App\Database\ConnectionFactory;
use App\Database\Errors\DbErrorMapper;
use App\Enums\DriverName;
use App\Enums\TransferMethod;
use App\Models\SavedConnection;
use App\Transfers\Io\DumpReader;
use App\Transfers\TransferProgress;
use LogicException;
use PDO;
use Pdo\Mysql;
use PDOException;
use Throwable;

/**
 * Runs a dump file against the open database in PHP: SqlStream splits it, RestoreFilter keeps it inside the open
 * database, and every statement goes to PDO::exec() as written (never prepared: dumps hold `?` and `:name` text).
 *
 * The restore gets a connection of its own, because dump files set session variables, and it runs without a
 * statement timeout. PostgreSQL and SQLite run the whole file in one transaction and roll it back on any error or
 * cancel. MySQL/MariaDB can't (DDL commits implicitly), so a failure there leaves what already ran.
 *
 * Statements run on the raw PDO rather than through Laravel's query methods, which reconnect and retry after a
 * lost connection: a retry would run the rest of the file outside the restore's transaction and session.
 */
final class BuiltinRestorer
{
    private const SNIPPET_CHARS = 300;

    public function __construct(
        private readonly ConnectionFactory $connections,
        private readonly DbErrorMapper $errors,
    ) {}

    /**
     * @return int statements run
     *
     * @throws RestoreFailed
     * @throws RestoreRefused
     */
    public function run(SavedConnection $connection, DumpReader $reader, TransferProgress $progress): int
    {
        if ($connection->read_only) {
            throw new RestoreRefused('This connection is read-only.');
        }

        $driver = $connection->driver;
        $db = $this->connections->make($connection);

        try {
            $pdo = $db->getPdo();
            $statements = fn () => $this->statements($pdo, $driver, (string) $connection->database, $reader, $progress);

            return match ($driver) {
                DriverName::MySql, DriverName::MariaDb => $this->mysql($pdo, $statements),
                DriverName::Postgres => $this->inTransaction($pdo, $statements),
                DriverName::Sqlite => $this->sqlite($pdo, $statements),
            };
        } finally {
            $this->connections->release($db);
        }
    }

    /** @param callable(): int $statements */
    private function mysql(PDO $pdo, callable $statements): int
    {
        // exec() leaves the rows of a statement that returns some (SELECT, CALL) pending, and the next statement
        // then fails with "unbuffered queries are active". Statements go through query() instead, every result
        // drained (see execute()). Emulated: sent as text, so any statement type works and nothing is parsed for
        // placeholders. Unbuffered: a large SELECT in a file streams past instead of filling memory.
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, true);
        $pdo->setAttribute(Mysql::ATTR_USE_BUFFERED_QUERY, false);

        return $statements();
    }

    /** @param callable(): int $statements */
    private function sqlite(PDO $pdo, callable $statements): int
    {
        // Laravel turns foreign keys on, and a dump's own PRAGMA foreign_keys=OFF is a no-op inside the transaction,
        // so they go off before it opens. The rows are checked once at the end instead.
        $previous = (int) $this->scalar($pdo, 'PRAGMA foreign_keys');
        $pdo->exec('PRAGMA foreign_keys=OFF');

        try {
            return $this->inTransaction($pdo, $statements, fn () => $this->checkForeignKeys($pdo));
        } finally {
            try {
                $pdo->exec('PRAGMA foreign_keys='.($previous === 1 ? 'ON' : 'OFF'));
            } catch (Throwable) {
                // The connection is released right after; nothing else runs on it.
            }
        }
    }

    /**
     * @param  callable(): int  $statements
     * @param  (callable(): void)|null  $beforeCommit
     */
    private function inTransaction(PDO $pdo, callable $statements, ?callable $beforeCommit = null): int
    {
        $pdo->beginTransaction();

        try {
            $count = $statements();
            if ($beforeCommit !== null) {
                $beforeCommit();
            }

            try {
                $pdo->commit();
            } catch (PDOException $e) {
                // e.g. a deferred PostgreSQL constraint, checked only now.
                throw new RestoreFailed(0, '', $this->errors->map($e)->message, $e);
            }

            return $count;
        } catch (Throwable $e) {
            $this->rollBack($pdo);

            throw $e;
        }
    }

    private function statements(PDO $pdo, DriverName $driver, string $database, DumpReader $reader, TransferProgress $progress): int
    {
        $filter = new RestoreFilter($driver, $database, TransferMethod::Builtin);
        $position = $reader->position();
        $count = 0;

        foreach ($filter->apply(SqlStream::pieces($reader, $driver->value)) as $piece) {
            if ($piece->kind === 'delimiter') {
                continue; // statements arrive without their delimiter
            }
            if ($piece->kind !== 'sql') {
                throw new LogicException("RestoreFilter let a {$piece->kind} piece through on the built-in method.");
            }

            $progress->checkCancelled();

            try {
                $this->execute($pdo, $driver, $piece->text);
            } catch (PDOException $e) {
                throw new RestoreFailed($piece->number, $this->snippet($piece->text), $this->errors->map($e)->message, $e);
            }

            $count++;
            $now = $reader->position();
            $progress->advance(bytes: $now - $position, statements: 1);
            $position = $now;
        }

        if ($reader->position() > $position) {
            $progress->advance(bytes: $reader->position() - $position);
        }

        return $count;
    }

    private function execute(PDO $pdo, DriverName $driver, string $sql): void
    {
        if ($driver !== DriverName::MySql && $driver !== DriverName::MariaDb) {
            $pdo->exec($sql);

            return;
        }

        $result = $pdo->query($sql);
        if ($result === false) {
            return;
        }
        // Every result set (a CALL can return several) is read off the connection; an error in a later one throws.
        while ($result->nextRowset()) {
            // nothing to keep
        }
        $result->closeCursor();
    }

    /** Fails the restore when the restored rows break a foreign key (they went in with the checks off). */
    private function checkForeignKeys(PDO $pdo): void
    {
        $check = $pdo->query('PRAGMA foreign_key_check');
        if ($check === false) {
            return;
        }
        $row = $check->fetch(PDO::FETCH_NUM);
        $check->closeCursor();

        if (is_array($row)) {
            throw new RestoreFailed(0, '', sprintf(
                'Foreign key check failed: table "%s" has rows that point to missing rows in "%s".',
                (string) $row[0],
                (string) $row[2],
            ));
        }
    }

    private function rollBack(PDO $pdo): void
    {
        try {
            $pdo->rollBack();
        } catch (Throwable) {
            // Already ended by the server (SQLite rolls back by itself on some errors) or the connection is gone;
            // releasing the connection ends whatever is left.
        }
    }

    private function scalar(PDO $pdo, string $sql): mixed
    {
        $statement = $pdo->query($sql);

        return $statement === false ? null : $statement->fetchColumn();
    }

    private function snippet(string $sql): string
    {
        return mb_scrub(mb_substr($sql, 0, self::SNIPPET_CHARS, 'UTF-8'), 'UTF-8');
    }
}
