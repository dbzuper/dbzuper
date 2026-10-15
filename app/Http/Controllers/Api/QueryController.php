<?php

namespace App\Http\Controllers\Api;

use App\Database\DriverRegistry;
use App\Database\Query\QueryGuard;
use App\Database\Query\QueryRunner;
use App\Database\Sql\Classification;
use App\Database\Sql\SqlSplitter;
use App\Database\Sql\StatementClassifier;
use App\Http\Controllers\Controller;
use App\Http\Requests\QueryRequest;
use App\Models\SavedConnection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class QueryController extends Controller
{
    public function run(QueryRequest $request, SavedConnection $connection, QueryGuard $guard, QueryRunner $runner): JsonResponse
    {
        Gate::authorize('view', $connection);
        $dialect = $connection->driver->value;

        $items = [];
        foreach ($request->validated('statements') as $i => $statement) {
            $sql = $this->single($statement['sql'], $dialect, "statements.{$i}.sql");
            $items[] = [
                'sql' => $sql,
                'classification' => StatementClassifier::classify($sql, $dialect),
                'confirmed' => (bool) ($statement['confirmed'] ?? false),
                'typed' => $statement['typed'] ?? null,
            ];
        }

        $guard->check($connection, $items);
        $results = $runner->run($connection, $items, (int) $request->validated('max_rows', 1000));

        return response()->json(['results' => array_map(fn ($r) => $r->toArray(), $results)]);
    }

    public function explain(Request $request, SavedConnection $connection, DriverRegistry $drivers, QueryRunner $runner): JsonResponse
    {
        Gate::authorize('view', $connection);
        $data = $request->validate(['sql' => ['required', 'string', 'max:200000']]);
        $dialect = $connection->driver->value;
        $sql = $this->single($data['sql'], $dialect, 'sql');
        if (preg_match('/^\s*(explain|describe|desc)\b/i', $sql)) {
            throw ValidationException::withMessages(['sql' => 'Enter the statement to explain without EXPLAIN.']);
        }

        // A plain EXPLAIN (no ANALYZE) never executes the statement, so it is safe on any connection.
        $plan = $drivers->for($connection->driver)->explainPrefix().$sql;
        $results = $runner->run($connection, [['sql' => $plan, 'classification' => new Classification('read', 'EXPLAIN')]], 1000, record: false);

        return response()->json(['results' => array_map(fn ($r) => $r->toArray(), $results)]);
    }

    private function single(string $sql, string $dialect, string $field): string
    {
        $parts = SqlSplitter::split($sql, $dialect);
        if (count($parts) !== 1) {
            throw ValidationException::withMessages([$field => 'Each item must contain exactly one SQL statement.']);
        }

        return $parts[0]['sql'];
    }
}
