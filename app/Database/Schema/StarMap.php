<?php

namespace App\Database\Schema;

use App\Models\LayoutPosition;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use Illuminate\Support\Facades\Cache;

/**
 * The small schema "star map" drawn on a connection card: the snapshot's preview nodes placed at their
 * saved layout positions, normalised to the unit square. Cached per snapshot and layout version, so a
 * layout payload is decoded only when one of them changes.
 */
class StarMap
{
    public const TTL_SECONDS = 3600 * 24;

    /**
     * `$connection->layout` should be loaded with only `id` and `updated_at`; the payload is read on a cache miss.
     *
     * @return array{points: list<array{0: float, 1: float}|null>|null, edges: list<array{0: int, 1: int}>, count: int}|null
     */
    public static function for(SavedConnection $connection, ?StoredSnapshot $latest): ?array
    {
        if ($latest === null) {
            return null;
        }

        $layout = $connection->layout;
        $key = "star:{$connection->id}:{$latest->id}:".($layout?->updated_at?->getTimestamp() ?? 0);

        return Cache::remember($key, self::TTL_SECONDS, function () use ($latest, $layout) {
            $nodes = array_values($latest->preview['nodes'] ?? []);
            $edges = array_map(fn ($e) => [(int) $e[0], (int) $e[1]], array_values($latest->preview['edges'] ?? []));
            $payload = $layout ? LayoutPosition::query()->whereKey($layout->id)->first(['id', 'payload'])?->payload : null;

            return [
                'points' => $payload === null ? null : self::points($nodes, $payload),
                'edges' => $edges,
                'count' => count($nodes),
            ];
        });
    }

    /**
     * @param  list<string>  $nodes
     * @param  list<array{table: string, x: float, y: float}>  $payload
     * @return list<array{0: float, 1: float}|null>
     */
    private static function points(array $nodes, array $payload): array
    {
        $byTable = [];
        foreach ($payload as $position) {
            $byTable[$position['table']] = [(float) $position['x'], (float) $position['y']];
        }

        $placed = array_map(fn ($node) => $byTable[$node] ?? null, $nodes);
        $present = array_filter($placed);
        if ($present === []) {
            return $placed;
        }

        $xs = array_column($present, 0);
        $ys = array_column($present, 1);
        [$minX, $maxX, $minY, $maxY] = [min($xs), max($xs), min($ys), max($ys)];

        return array_map(fn ($p) => $p === null ? null : [
            self::scale($p[0], $minX, $maxX),
            self::scale($p[1], $minY, $maxY),
        ], $placed);
    }

    /** Position of `$v` within [min, max], or the middle when the range is empty. */
    private static function scale(float $v, float $min, float $max): float
    {
        return $max > $min ? round(($v - $min) / ($max - $min), 4) : 0.5;
    }
}
