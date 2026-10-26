<?php

namespace App\Http\Middleware;

use App\Models\QueryHistoryEntry;
use App\Models\SavedConnection;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'name' => config('app.name'),
            'auth' => [
                'user' => $request->user(),
            ],
            'sidebarOpen' => ! $request->hasCookie('sidebar_state') || $request->cookie('sidebar_state') === 'true',
            'sidebar' => fn () => $this->sidebar($request),
        ];
    }

    /**
     * Recent connections and queries for the app sidebar; two queries, null for guests.
     *
     * @return array<string, mixed>|null
     */
    private function sidebar(Request $request): ?array
    {
        $user = $request->user();

        if (! $user) {
            return null;
        }

        $connections = SavedConnection::query()
            ->where('user_id', $user->id)
            ->get(['id', 'name', 'color', 'driver', 'last_opened_at'])
            ->keyBy('id');

        $queries = QueryHistoryEntry::query()
            ->whereIn('connection_id', $connections->keys())
            // Ids rise with inserts; ordering by id rides the (connection_id, id) index, created_at has none.
            ->latest('id')
            ->limit(3)
            ->get(['id', 'connection_id', 'database', 'sql', 'created_at']);

        return [
            'recentConnections' => $connections
                ->whereNotNull('last_opened_at')
                ->sortByDesc('last_opened_at')
                ->take(4)
                ->map(fn (SavedConnection $c) => [
                    'id' => $c->id,
                    'name' => $c->name,
                    'color' => $c->color,
                    'driver_label' => $c->driver->label(),
                ])
                ->values()
                ->all(),
            'recentQueries' => $queries->map(fn (QueryHistoryEntry $q) => [
                'id' => $q->id,
                'connection_id' => $q->connection_id,
                'connection_name' => $connections[$q->connection_id]->name,
                'database' => $q->database === '' ? null : $q->database,
                'workspace_ref' => $q->workspaceRef(),
                'color' => $connections[$q->connection_id]->color,
                'sql' => mb_substr(self::firstLine($q->sql), 0, 120),
                'created_at' => $q->created_at?->toIso8601String(),
            ])->all(),
        ];
    }

    private static function firstLine(string $sql): string
    {
        foreach (preg_split('/\R/', $sql) as $line) {
            if (trim($line) !== '') {
                return trim($line);
            }
        }

        return '';
    }
}
