<?php

namespace App\Jobs;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Query\HistoryRecorder;
use App\Database\Schema\SnapshotService;
use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\Import\BuiltinRestorer;
use App\Transfers\Import\RestoreFailed;
use App\Transfers\Io\DumpReader;
use App\Transfers\Native\Compatibility;
use App\Transfers\Native\NativeRestorer;
use App\Transfers\TransferProgress;
use App\Transfers\TransferStorage;
use Illuminate\Database\Connection;
use RuntimeException;
use Throwable;

/**
 * A restore (spec §3): the uploaded file, gzip or plain, run against the open database by the built-in restorer or
 * the native client. The method was chosen when the restore was started; a native client that became unusable since
 * fails the restore with its reason instead of silently switching methods. The upload is deleted however it ends.
 */
class RunImport extends TransferJob
{
    public const FILE_GONE = 'The uploaded file is no longer available. Upload it again.';

    protected function perform(Transfer $transfer, TransferProgress $progress): void
    {
        $connection = $this->targetConnection($transfer, 'restore');
        $path = (string) $transfer->file_path;

        try {
            if ($path === '' || ! is_file($path)) {
                throw new RuntimeException('missing');
            }
            $reader = new DumpReader($path);
        } catch (RuntimeException) {
            // Never the server path.
            throw new RuntimeException(self::FILE_GONE);
        }

        try {
            if ($transfer->method === TransferMethod::Native) {
                $check = Compatibility::check($connection->driver, $this->serverVersion($connection), TransferDirection::Import);
                if (! $check->usable) {
                    throw new RuntimeException('The native restore tool can no longer be used: '.preg_replace('/ — using built-in$/u', '', $check->reason));
                }
                app(NativeRestorer::class)->run($connection, $check, $reader, $progress);
            } else {
                app(BuiltinRestorer::class)->run($connection, $reader, $progress);
            }
        } catch (RestoreFailed $e) {
            throw new RuntimeException(self::describe($e, $connection->driver, $transfer->method), 0, $e);
        } finally {
            // Closed before the job's hooks delete the upload.
            $reader->close();
        }
    }

    protected function onDone(Transfer $transfer): void
    {
        $this->removeFile($transfer);
        $connection = $transfer->runConnection();

        try {
            // Spec: the schema snapshot refreshes after a restore. The restore itself succeeded either way.
            app(SnapshotService::class)->refresh($connection);
        } catch (Throwable $e) {
            report($e);
        }

        app(HistoryRecorder::class)->recordTransfer($connection, $transfer);
    }

    protected function onCancelled(Transfer $transfer): void
    {
        $this->removeFile($transfer);
    }

    protected function onFailed(Transfer $transfer, Throwable $e): void
    {
        $this->removeFile($transfer);

        try {
            app(HistoryRecorder::class)->recordTransfer($transfer->runConnection(), $transfer);
        } catch (Throwable $historyError) {
            report($historyError);
        }
    }

    /**
     * "Statement 12 failed: {error}", a newline and the statement's start, then what that means for the database:
     * PostgreSQL and SQLite roll the whole restore back, MySQL/MariaDB keep what ran before (DDL commits).
     */
    public static function describe(RestoreFailed $e, DriverName $driver, TransferMethod $method): string
    {
        $outcome = in_array($driver, [DriverName::MySql, DriverName::MariaDb], true)
            ? 'Statements before it were applied.'
            : 'Nothing was changed.';

        if ($e->statementNumber > 0) {
            $text = "Statement {$e->statementNumber} failed: {$e->getMessage()}";
            if ($e->snippet !== '') {
                $text .= "\n".$e->snippet;
            }
        } elseif ($method === TransferMethod::Builtin) {
            // Built-in: every statement ran; the commit or SQLite's closing foreign key check failed.
            $text = "The restore failed at the end: {$e->getMessage()}";
        } else {
            // A native client reports where it stopped in its own message.
            $text = $e->getMessage();
        }

        return $text."\n".$outcome;
    }

    private function removeFile(Transfer $transfer): void
    {
        TransferStorage::deleteFiles($transfer);
        $transfer->forceFill(['file_path' => null])->save();
    }

    private function serverVersion(SavedConnection $connection): string
    {
        if ($connection->driver === DriverName::Sqlite) {
            return '';
        }

        return app(ConnectionFactory::class)->using(
            $connection,
            fn (Connection $db): string => (string) $db->selectOne(app(DriverRegistry::class)->for($connection->driver)->versionQuery())->version,
            (int) config('dbzuper.query_timeout'),
        );
    }
}
