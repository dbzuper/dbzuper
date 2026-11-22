<?php

namespace App\Transfers;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Models\SavedConnection;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Native\Compatibility;
use App\Transfers\Native\NativeExporter;
use App\Transfers\Native\ToolCheck;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

/** Decides which method a backup or restore will use, and what the dialogs say about it. */
class TransferPlanner
{
    public function __construct(
        private readonly ConnectionFactory $connections,
        private readonly DriverRegistry $drivers,
        private readonly DbErrorMapper $errors,
        private readonly BuiltinExporters $builtin,
        private readonly NativeExporter $native,
    ) {}

    /**
     * @param  list<string>|null  $tables  object keys the backup is limited to; null = everything
     * @return array{read_only: bool, database_name: string, worker_alive: bool, export: array{native: array<string, mixed>, default_method: string, builtin_gaps: list<string>, native_gaps: list<string>}, import: array{native: array<string, mixed>, default_method: string, all_or_nothing: bool}}
     */
    public function capabilities(SavedConnection $c, ?array $tables = null): array
    {
        $version = $this->serverVersion($c);
        $export = $this->check($c, $version, TransferDirection::Export);
        $import = $this->check($c, $version, TransferDirection::Import);

        return [
            'read_only' => (bool) $c->read_only,
            'database_name' => $this->databaseName($c),
            'worker_alive' => WorkerHeartbeat::alive(),
            'export' => [
                'native' => $export->toArray(),
                'default_method' => $export->usable ? TransferMethod::Native->value : TransferMethod::Builtin->value,
                'builtin_gaps' => $this->builtin->for($c->driver)->gaps(),
                'native_gaps' => $export->usable ? $this->native->gapsFor($c, $tables) : [],
            ],
            'import' => [
                'native' => $import->toArray(),
                'default_method' => $import->usable ? TransferMethod::Native->value : TransferMethod::Builtin->value,
                'all_or_nothing' => in_array($c->driver, [DriverName::Postgres, DriverName::Sqlite], true),
            ],
        ];
    }

    /**
     * @return array{0: TransferMethod, 1: ToolCheck}
     *
     * @throws HttpException 422 when native is requested but unusable
     */
    public function resolve(SavedConnection $c, TransferDirection $d, ?TransferMethod $requested): array
    {
        $check = $this->check($c, $this->serverVersion($c), $d);

        if ($requested === TransferMethod::Native) {
            abort_unless($check->usable, 422, $check->reason);

            return [TransferMethod::Native, $check];
        }
        if ($requested === TransferMethod::Builtin) {
            return [TransferMethod::Builtin, $check];
        }

        return [$check->usable ? TransferMethod::Native : TransferMethod::Builtin, $check];
    }

    public function databaseName(SavedConnection $c): string
    {
        return $c->driver === DriverName::Sqlite ? basename((string) $c->database) : (string) $c->database;
    }

    /** Tool checks are cached per driver, server version and direction for a minute. */
    public function check(SavedConnection $c, string $version, TransferDirection $d): ToolCheck
    {
        $key = 'dbzuper.transfer-check.'.sha1($c->driver->value.'|'.$version.'|'.$d->value);

        /** @var array{usable: bool, tool: ?string, path: ?string, version: ?string, reason: string} $cached */
        $cached = Cache::remember(
            $key,
            now()->addSeconds(60),
            fn (): array => Compatibility::check($c->driver, $version, $d)->toArray(),
        );

        return ToolCheck::fromArray($cached);
    }

    private function serverVersion(SavedConnection $c): string
    {
        if ($c->driver === DriverName::Sqlite) {
            return '';
        }

        try {
            return $this->connections->using(
                $c,
                fn (Connection $db): string => (string) $db->selectOne($this->drivers->for($c->driver)->versionQuery())->version,
                (int) config('dbzuper.query_timeout'),
            );
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($this->errors->map($e));
        }
    }
}
