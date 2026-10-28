<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PinnedTable;
use App\Models\SavedConnection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class PinController extends Controller
{
    private const MAX_PINS = 200;

    public function index(Request $request, SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);

        return response()->json(['pins' => $this->list($request, $connection)]);
    }

    public function store(Request $request, SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);
        $table = $request->validate(['table' => ['required', 'string', 'max:255']])['table'];
        $mine = $this->mine($request, $connection);

        if ($existing = (clone $mine)->where('table_name', $table)->first()) {
            return response()->json(['pin' => $existing->toClientArray()]);
        }
        if ((clone $mine)->count() >= self::MAX_PINS) {
            throw ValidationException::withMessages(['table' => 'You can pin up to '.self::MAX_PINS.' tables per connection.']);
        }
        try {
            $pin = $connection->pins()->create([
                'user_id' => $request->user()->id,
                'table_name' => $table,
                'position' => ((clone $mine)->max('position') ?? 0) + 1,
            ]);
        } catch (UniqueConstraintViolationException) {
            // A concurrent request pinned the same table between the check above and this insert.
            return response()->json(['pin' => (clone $mine)->where('table_name', $table)->firstOrFail()->toClientArray()]);
        }

        return response()->json(['pin' => $pin->toClientArray()], 201);
    }

    public function destroy(Request $request, SavedConnection $connection, int $pin): Response
    {
        Gate::authorize('view', $connection);
        $this->mine($request, $connection)->whereKey($pin)->firstOrFail()->delete();

        return response()->noContent();
    }

    public function reorder(Request $request, SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);
        $ids = $request->validate(['ids' => ['required', 'array', 'max:'.self::MAX_PINS], 'ids.*' => ['integer', 'distinct']])['ids'];
        $current = $this->mine($request, $connection)->pluck('id')->all();
        sort($current);
        $given = $ids;
        sort($given);
        if ($current !== $given) {
            throw ValidationException::withMessages(['ids' => 'The list must contain exactly your pins for this connection.']);
        }
        DB::transaction(function () use ($ids, $request, $connection) {
            foreach ($ids as $position => $id) {
                $this->mine($request, $connection)->whereKey($id)->update(['position' => $position + 1]);
            }
        });

        return response()->json(['pins' => $this->list($request, $connection)]);
    }

    /** @return HasMany<PinnedTable, SavedConnection> */
    private function mine(Request $request, SavedConnection $connection): HasMany
    {
        return $connection->pins()->where('user_id', $request->user()->id);
    }

    /** @return list<array{id: int, table: string, position: int}> */
    private function list(Request $request, SavedConnection $connection): array
    {
        return array_values($this->mine($request, $connection)->orderBy('position')->orderBy('id')->get()
            ->map(fn (PinnedTable $p) => $p->toClientArray())->all());
    }
}
