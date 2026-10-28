<?php

namespace App\Http\Controllers;

use App\Database\Schema\StarMap;
use App\Enums\DriverName;
use App\Http\Requests\ConnectionRequest;
use App\Models\LayoutPosition;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class ConnectionController extends Controller
{
    public function index(Request $request): Response
    {
        $user = $request->user();
        $connections = $user->connections()->orderBy('name')
            ->with([
                // Only the version stamp: StarMap reads the payload on a cache miss.
                'layout' => fn ($q) => $q->select('id', 'connection_id', 'updated_at'),
                'pins' => fn ($q) => $q->where('user_id', $user->id)->orderBy('position')->select('connection_id', 'table_name', 'position'),
            ])
            ->get();

        // The latest snapshot of each connection, without its (large) payload.
        $snapshots = StoredSnapshot::query()
            ->select('id', 'connection_id', 'table_count', 'view_count', 'preview', 'created_at')
            ->whereIn('id', StoredSnapshot::query()->selectRaw('max(id)')
                // Server-level connections have no connection-wide snapshot: theirs belong to single databases.
                ->whereIn('connection_id', $connections->modelKeys())->where('database', '')->groupBy('connection_id'))
            ->get()->keyBy('connection_id');

        return Inertia::render('connections/index', [
            'connections' => $connections->map(function (SavedConnection $connection) use ($snapshots) {
                $latest = $snapshots->get($connection->id);

                return [
                    ...$connection->toClientArray(),
                    'database_label' => $connection->isServerLevel() ? 'All databases' : $connection->database,
                    'tables' => $latest?->table_count,
                    'views' => $latest?->view_count,
                    'snapshot_at' => $latest?->created_at->toIso8601String(),
                    'pins' => $connection->pins->take(5)->pluck('table_name')->values()->all(),
                    'star' => StarMap::for($connection, $latest),
                ];
            })->values(),
        ]);
    }

    public function create(): Response
    {
        return Inertia::render('connections/form', ['connection' => null, 'drivers' => $this->drivers()]);
    }

    public function store(ConnectionRequest $request): RedirectResponse
    {
        $request->user()->connections()->create($request->connectionAttributes());

        return redirect()->route('connections.index');
    }

    public function edit(SavedConnection $connection): Response
    {
        Gate::authorize('update', $connection);

        return Inertia::render('connections/form', ['connection' => $connection->toClientArray(), 'drivers' => $this->drivers()]);
    }

    public function update(ConnectionRequest $request, SavedConnection $connection): RedirectResponse
    {
        Gate::authorize('update', $connection);
        $before = $this->schemaSource($connection);
        $oldDatabase = $connection->database;
        $connection->update($request->connectionAttributes());
        $after = $this->schemaSource($connection);
        if ($after === $before) {
            return redirect()->route('connections.index');
        }

        $sameServer = array_diff_key($after, ['database' => 1]) === array_diff_key($before, ['database' => 1]);
        if ($sameServer && filled($oldDatabase) && $connection->isServerLevel()) {
            // Fixed → server-level on the same server: what was saved still describes that one database.
            foreach (self::PER_DATABASE_TABLES as $table) {
                DB::table($table)->where('connection_id', $connection->id)->where('database', '')->update(['database' => $oldDatabase]);
            }

            return redirect()->route('connections.index');
        }

        // A snapshot describes one server/database/schema; once the connection points elsewhere it is stale.
        StoredSnapshot::query()->where('connection_id', $connection->id)->delete();
        LayoutPosition::query()->where('connection_id', $connection->id)->delete();
        if (blank($oldDatabase) && ! $connection->isServerLevel()) {
            // Server-level → fixed: pins and history of single databases have nowhere to go.
            foreach (['pinned_tables', 'query_history'] as $table) {
                DB::table($table)->where('connection_id', $connection->id)->where('database', '<>', '')->delete();
            }
        }

        return redirect()->route('connections.index');
    }

    public function destroy(SavedConnection $connection): RedirectResponse
    {
        Gate::authorize('delete', $connection);
        $connection->delete();

        return redirect()->route('connections.index');
    }

    /** Tables whose rows describe one database of a connection (see the `database` column). */
    private const PER_DATABASE_TABLES = ['schema_snapshots', 'layout_positions', 'pinned_tables', 'query_history'];

    /**
     * The values that decide which schema a snapshot describes.
     *
     * @return array{driver: string, host: string, port: int, database: string, schema: string}
     */
    private function schemaSource(SavedConnection $connection): array
    {
        return [
            'driver' => $connection->driver->value,
            'host' => (string) $connection->host,
            'port' => (int) $connection->port,
            'database' => (string) $connection->database,
            'schema' => (string) ($connection->options['schema'] ?? 'public'),
        ];
    }

    /** @return list<array{value: string, label: string, default_port: ?int}> */
    private function drivers(): array
    {
        return array_map(fn (DriverName $d) => [
            'value' => $d->value, 'label' => $d->label(), 'default_port' => $d->defaultPort(),
        ], DriverName::cases());
    }
}
