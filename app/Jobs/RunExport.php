<?php

namespace App\Jobs;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Query\HistoryRecorder;
use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\DumpHeader;
use App\Transfers\Export\DumpObject;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Export\ObjectLister;
use App\Transfers\Io\DumpWriter;
use App\Transfers\Native\Compatibility;
use App\Transfers\Native\NativeExporter;
use App\Transfers\TransferPlanner;
use App\Transfers\TransferProgress;
use App\Transfers\TransferStorage;
use Illuminate\Database\Connection;
use RuntimeException;
use Throwable;

/**
 * A backup (spec §2): the built-in exporter or the native dump tool, streamed into the transfer's file. The method
 * was chosen when the backup was started; a native tool that became unusable since fails the backup with its
 * reason instead of silently switching methods.
 */
class RunExport extends TransferJob
{
    public const RLS_MESSAGE = "A table has row-level security that this login can't bypass. Connect as the table owner or a role with BYPASSRLS.";

    protected function perform(Transfer $transfer, TransferProgress $progress): void
    {
        $connection = $transfer->runConnection();
        $options = ExportOptions::fromRequest($transfer->options ?? []);
        $factory = app(ConnectionFactory::class);

        // Saved before the file exists: the cleanup only deletes files it knows about.
        $path = TransferStorage::directory($transfer).DIRECTORY_SEPARATOR.($options->gzip ? 'export.sql.gz' : 'export.sql');
        $transfer->forceFill(['file_path' => $path])->save();

        $writer = null;
        $db = $factory->make($connection);

        try {
            $chosen = $this->chosen($db, $connection, $options);
            $transfer->forceFill([
                'rows_total' => $options->data ? $this->rowsTotal($connection, $chosen) : null,
                'options' => [...($transfer->options ?? []), 'table_count' => count(array_filter($chosen, fn (DumpObject $o) => $o->kind === 'table'))],
            ])->save();

            $writer = new DumpWriter($path, $options->gzip);

            if ($transfer->method === TransferMethod::Native) {
                $version = $this->serverVersion($db, $connection);
                $factory->release($db);
                $db = null;

                $check = Compatibility::check($connection->driver, $version, TransferDirection::Export);
                if (! $check->usable) {
                    throw new RuntimeException('The native backup tool can no longer be used: '.preg_replace('/ — using built-in$/u', '', $check->reason));
                }
                app(NativeExporter::class)->run($connection, $check, $options, $chosen, $writer, $progress, []);
            } else {
                $exporter = app(BuiltinExporters::class)->for($connection->driver);
                $gaps = $exporter->gaps();
                $transfer->forceFill(['warnings' => $gaps])->save();

                $writer->write(DumpHeader::render([
                    'app_version' => (string) config('dbzuper.version'),
                    'engine' => $connection->driver->value,
                    'server_version' => $this->serverVersion($db, $connection),
                    'database' => app(TransferPlanner::class)->databaseName($connection),
                    'date' => now('UTC')->format('Y-m-d H:i:s').' UTC',
                    'method' => 'built-in',
                    'options' => $this->describe($options),
                    'gaps' => $gaps,
                    'schemas' => $connection->driver === DriverName::Postgres
                        ? array_values(array_unique(array_map(fn (DumpObject $o) => (string) $o->schema, $chosen)))
                        : [],
                ]));
                $writer->write("\n");

                $exporter->export($db, $options, $writer, $progress);
            }

            $transfer->forceFill([
                'file_size' => $writer->close(),
                'expires_at' => now()->addHours((int) config('dbzuper.transfer_ttl_hours')),
            ])->save();
        } catch (Throwable $e) {
            // The job marks the transfer failed or cancelled and removes the directory.
            $writer?->abort();

            throw self::explain($e);
        } finally {
            if ($db !== null) {
                $factory->release($db);
            }
        }
    }

    protected function onDone(Transfer $transfer): void
    {
        app(HistoryRecorder::class)->recordTransfer($transfer->runConnection(), $transfer);
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

    /** Errors with a better explanation than the database's own text. */
    private static function explain(Throwable $e): Throwable
    {
        if (stripos($e->getMessage(), 'row-level security') !== false) {
            return new RuntimeException(self::RLS_MESSAGE, 0, $e);
        }

        return $e;
    }

    private function removeFile(Transfer $transfer): void
    {
        TransferStorage::deleteFiles($transfer);
        $transfer->forceFill(['file_path' => null, 'file_size' => null, 'expires_at' => null])->save();
    }

    /** @return list<DumpObject> the objects the backup covers, in the lister's order */
    private function chosen(Connection $db, SavedConnection $connection, ExportOptions $options): array
    {
        return array_values(array_filter(
            ObjectLister::list($db, $connection->driver),
            fn (DumpObject $o) => $options->tables === null || in_array($o->key(), $options->tables, true),
        ));
    }

    /**
     * The chosen tables' rows by the stored snapshot (no new introspection), or null when any of them is not in it
     * or has no count. A snapshot covers one schema: the connection's, or "public" for PostgreSQL.
     *
     * @param  list<DumpObject>  $chosen
     */
    private function rowsTotal(SavedConnection $connection, array $chosen): ?int
    {
        $snapshot = $connection->snapshots()->latest('id')->first();
        if ($snapshot === null) {
            return null;
        }

        $schema = (string) (($connection->options ?? [])['schema'] ?? 'public');
        $counts = [];
        foreach ($snapshot->payload['tables'] ?? [] as $table) {
            if ($table['kind'] === 'table') {
                $counts[$table['name']] = $table['row_count']['count'] ?? null;
            }
        }

        $total = 0;
        foreach ($chosen as $object) {
            if ($object->kind !== 'table') {
                continue;
            }
            $count = $object->schema === null || $object->schema === $schema ? ($counts[$object->name] ?? null) : null;
            if (! is_int($count)) {
                return null;
            }
            $total += $count;
        }

        return $total;
    }

    private function serverVersion(Connection $db, SavedConnection $connection): string
    {
        return (string) $db->selectOne(app(DriverRegistry::class)->for($connection->driver)->versionQuery())->version;
    }

    private function describe(ExportOptions $o): string
    {
        $parts = [];
        if ($o->structure) {
            $parts[] = 'structure';
        }
        if ($o->data) {
            $parts[] = 'data';
        }
        if ($o->structure && $o->dropFirst) {
            $parts[] = 'drop before create';
        }
        $parts[] = $o->tables === null ? 'all tables' : count($o->tables).' chosen';

        return implode(', ', $parts);
    }
}
