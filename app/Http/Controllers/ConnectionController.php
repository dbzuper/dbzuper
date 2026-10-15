<?php

namespace App\Http\Controllers;

use App\Enums\DriverName;
use App\Http\Requests\ConnectionRequest;
use App\Models\SavedConnection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class ConnectionController extends Controller
{
    public function index(Request $request): Response
    {
        return Inertia::render('connections/index', [
            'connections' => $request->user()->connections()->orderBy('name')->get()
                ->map->toClientArray()->values(),
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
