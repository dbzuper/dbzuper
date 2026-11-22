<?php

namespace App\Http\Controllers\Api;

use App\Database\ConnectionFactory;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\DatabaseOperationFailed;
use App\Database\Schema\SnapshotService;
use App\Http\Controllers\Controller;
use App\Models\SavedConnection;
use App\Transfers\Export\DumpObject;
use App\Transfers\Export\ObjectLister;
use App\Transfers\TransferPlanner;
use Illuminate\Database\Connection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Throwable;

class TransferController extends Controller
{
    public function capabilities(Request $request, SavedConnection $connection, TransferPlanner $planner): JsonResponse
    {
        Gate::authorize('view', $connection);
        $tables = $request->query('tables');
        $keys = is_array($tables) ? array_values(array_filter($tables, 'is_string')) : null;

        return response()->json($planner->capabilities($connection, $keys));
    }

    public function objects(SavedConnection $connection, ConnectionFactory $factory, DbErrorMapper $errors, SnapshotService $snapshots): JsonResponse
    {
        Gate::authorize('view', $connection);

        try {
            $objects = $factory->using($connection, fn (Connection $db): array => ObjectLister::list($db, $connection->driver), (int) config('dbzuper.query_timeout'));
        } catch (Throwable $e) {
            throw new DatabaseOperationFailed($errors->map($e));
        }

        // A snapshot covers one schema: the connection's, or "public" for PostgreSQL.
        $snapshotSchema = (string) (($connection->options ?? [])['schema'] ?? 'public');
        $rows = [];
        foreach ($snapshots->current($connection)->payload['tables'] as $table) {
            $rows[$table['name']] = $table['kind'] === 'table' ? ($table['row_count']['count'] ?? null) : null;
        }

        return response()->json(['objects' => array_map(
            fn (DumpObject $o): array => $o->toArray() + [
                'rows' => $o->kind === 'table' && ($o->schema === null || $o->schema === $snapshotSchema) ? ($rows[$o->name] ?? null) : null,
            ],
            $objects,
        )]);
    }
}
