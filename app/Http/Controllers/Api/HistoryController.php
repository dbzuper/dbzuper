<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\QueryHistoryEntry;
use App\Models\SavedConnection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class HistoryController extends Controller
{
    public const PER_PAGE = 50;

    public function index(Request $request, SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);

        return $this->page($request, QueryHistoryEntry::query()->where('connection_id', $connection->id), false);
    }

    public function clear(SavedConnection $connection): JsonResponse
    {
        Gate::authorize('view', $connection);

        return response()->json(['cleared' => $connection->history()->delete()]);
    }

    public function all(Request $request): JsonResponse
    {
        $ids = $request->user()->connections()->pluck('id');
        $query = QueryHistoryEntry::query()->whereIn('connection_id', $ids)->with('connection:id,name');
        if ($request->filled('connection_id')) {
            $query->where('connection_id', $request->integer('connection_id'));
        }

        return $this->page($request, $query, true);
    }

    private function page(Request $request, Builder $query, bool $withConnection): JsonResponse
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:500'],
            'status' => ['nullable', 'in:ok,error'],
            'before_id' => ['nullable', 'integer'],
        ]);

        if (! empty($data['q'])) {
            // '!' is the escape character (a backslash literal breaks on MySQL).
            $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $data['q']).'%';
            $column = $query->getQuery()->getGrammar()->wrap('sql');
            $query->whereRaw("{$column} LIKE ? ESCAPE '!'", [$like]);
        }
        if (! empty($data['status'])) {
            $query->where('status', $data['status']);
        }
        if (! empty($data['before_id'])) {
            $query->where('id', '<', $data['before_id']);
        }

        $entries = $query->orderByDesc('id')->limit(self::PER_PAGE + 1)->get();
        $more = $entries->count() > self::PER_PAGE;
        $entries = $entries->take(self::PER_PAGE);

        return response()->json([
            'entries' => $entries->map(fn (QueryHistoryEntry $e) => $e->toApiArray() + ($withConnection ? ['connection' => ['id' => $e->connection->id, 'name' => $e->connection->name]] : []))->values(),
            'next_before_id' => $more ? $entries->last()->id : null,
        ]);
    }
}
