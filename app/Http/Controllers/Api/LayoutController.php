<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SavedConnection;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class LayoutController extends Controller
{
    public const MAX_ENTRIES = 10000;

    public const LOCK_WAIT_SECONDS = 5;

    /** Saved positions allowed per layout: at least MAX_ENTRIES, and never fewer than the schema object cap. */
    public static function maxEntries(): int
    {
        return max(self::MAX_ENTRIES, (int) config('dbzuper.schema_max_objects'));
    }

    public function show(SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);

        return response()->json(['positions' => $connection->layout->payload ?? []]);
    }

    public function update(Request $request, SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);

        $data = $request->validate([
            'merge' => ['sometimes', 'boolean'],
            'positions' => ['present', 'array', 'max:'.self::maxEntries()],
            'positions.*.table' => ['required', 'string', 'max:255'],
            'positions.*.x' => ['required', 'numeric', 'between:-10000000,10000000'],
            'positions.*.y' => ['required', 'numeric', 'between:-10000000,10000000'],
            'positions.*.pinned' => ['required', 'boolean'],
        ]);

        $positions = array_values(array_map(fn (array $p) => [
            'table' => (string) $p['table'],
            'x' => (float) $p['x'],
            'y' => (float) $p['y'],
            'pinned' => (bool) $p['pinned'],
        ], $data['positions']));

        // Saves of one connection run one at a time, so a merge never reads a layout a concurrent
        // save is about to replace.
        try {
            Cache::lock('layout:'.$connection->workspaceRef(), 10)->block(self::LOCK_WAIT_SECONDS, function () use ($request, $connection, $positions) {
                if ($request->boolean('merge')) {
                    $positions = $this->merged($connection, $positions);
                }
                $connection->layout()->updateOrCreate([], ['payload' => $positions]);
            });
        } catch (LockTimeoutException) {
            return response()->json(['saved' => false, 'message' => 'The layout is being saved; try again.'], 409);
        }

        return response()->json(['saved' => true]);
    }

    /**
     * Stored positions with `$positions` merged in by table. Tables missing from the current snapshot
     * are dropped, so stale entries do not accumulate.
     *
     * @param  list<array{table: string, x: float, y: float, pinned: bool}>  $positions
     * @return list<array{table: string, x: float, y: float, pinned: bool}>
     */
    private function merged(SavedConnection $connection, array $positions): array
    {
        $merged = [];
        foreach ($connection->layout->payload ?? [] as $stored) {
            $merged[$stored['table']] = $stored;
        }
        foreach ($positions as $position) {
            $merged[$position['table']] = $position;
        }

        $tables = $connection->snapshots()->latest('id')->first()?->payload['tables'] ?? [];
        if ($tables !== []) {
            $merged = array_intersect_key($merged, array_flip(array_column($tables, 'name')));
        }

        if (count($merged) > self::maxEntries()) {
            throw ValidationException::withMessages(['positions' => 'The layout would exceed '.self::maxEntries().' entries.']);
        }

        return array_values($merged);
    }
}
