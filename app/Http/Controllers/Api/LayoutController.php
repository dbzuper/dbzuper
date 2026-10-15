<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SavedConnection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class LayoutController extends Controller
{
    public const MAX_ENTRIES = 10000;

    /** Saved positions allowed per layout: at least MAX_ENTRIES, and never fewer than the schema object cap. */
    public static function maxEntries(): int
    {
        return max(self::MAX_ENTRIES, (int) config('dbsuperb.schema_max_objects'));
    }

    public function show(SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);

        return response()->json(['positions' => array_values($connection->layout?->payload ?? [])]);
    }

    public function update(Request $request, SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);

        $data = $request->validate([
            'positions' => ['present', 'array', 'max:'.self::maxEntries()],
            'positions.*.table' => ['required', 'string', 'max:255'],
            'positions.*.x' => ['required', 'numeric', 'between:-10000000,10000000'],
            'positions.*.y' => ['required', 'numeric', 'between:-10000000,10000000'],
            'positions.*.pinned' => ['required', 'boolean'],
        ]);

        $positions = array_map(fn (array $p) => [
            'table' => (string) $p['table'],
            'x' => (float) $p['x'],
            'y' => (float) $p['y'],
            'pinned' => (bool) $p['pinned'],
        ], $data['positions']);

        $connection->layout()->updateOrCreate([], ['payload' => $positions]);

        return response()->json(['saved' => true]);
    }
}
