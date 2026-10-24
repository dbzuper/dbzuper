<?php

namespace App\Http\Controllers;

use App\Database\Schema\StarMap;
use App\Enums\DriverName;
use App\Http\Requests\ConnectionRequest;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
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
                ->whereIn('connection_id', $connections->modelKeys())->groupBy('connection_id'))
            ->get()->keyBy('connection_id');

        return Inertia::render('connections/index', [
            'connections' => $connections->map(function (SavedConnection $connection) use ($snapshots) {
                $latest = $snapshots->get($connection->id);

                return [
                    ...$connection->toClientArray(),
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
        $connection->update($request->connectionAttributes());

        // A snapshot describes one server/database/schema; once the connection points elsewhere it is stale.
        if ($this->schemaSource($connection) !== $before) {
            $connection->snapshots()->delete();
            $connection->layout()->delete();
        }

        return redirect()->route('connections.index');
    }

    public function destroy(SavedConnection $connection): RedirectResponse
    {
        Gate::authorize('delete', $connection);
        $connection->delete();

        return redirect()->route('connections.index');
    }

    /** The values that decide which schema a snapshot describes. */
    private function schemaSource(SavedConnection $connection): array
    {
        return [
            $connection->driver->value,
            (string) $connection->host,
            (int) $connection->port,
            (string) $connection->database,
            (string) ($connection->options['schema'] ?? 'public'),
        ];
    }

    private function drivers(): array
    {
        return array_map(fn (DriverName $d) => [
            'value' => $d->value, 'label' => $d->label(), 'default_port' => $d->defaultPort(),
        ], DriverName::cases());
    }
}
