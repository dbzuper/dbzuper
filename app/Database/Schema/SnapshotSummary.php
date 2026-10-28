<?php

namespace App\Database\Schema;

/** Counts and a small sampled graph of a stored snapshot payload, kept beside it for the connections index. */
final class SnapshotSummary
{
    public const PREVIEW_NODES = 80;

    /**
     * Nodes are the most connected tables by declared foreign keys (ties alphabetical), then filled alphabetically;
     * edges are index pairs into the nodes, declared foreign keys only.
     *
     * @param  array<string, mixed>  $payload  a stored snapshot payload, possibly from an older version
     * @return array{table_count: int, view_count: int, preview: array{nodes: list<string>, edges: list<array{0: int, 1: int}>}}
     */
    public static function of(array $payload): array
    {
        $tables = [];
        $views = 0;
        foreach ($payload['tables'] ?? [] as $table) {
            if (($table['kind'] ?? 'table') === 'view') {
                $views++;
            } else {
                $tables[] = (string) $table['name'];
            }
        }

        $known = array_fill_keys($tables, true);
        $relations = array_values(array_filter(
            $payload['relationships'] ?? [],
            fn (array $r) => ! ($r['inferred'] ?? false) && isset($known[$r['from_table']], $known[$r['to_table']]),
        ));

        $degree = array_fill_keys($tables, 0);
        foreach ($relations as $r) {
            $degree[$r['from_table']]++;
            $degree[$r['to_table']]++;
        }

        $nodes = $tables;
        usort($nodes, fn (string $a, string $b) => $degree[$b] <=> $degree[$a] ?: strcasecmp($a, $b) ?: strcmp($a, $b));
        $nodes = array_slice($nodes, 0, self::PREVIEW_NODES);

        $index = array_flip($nodes);
        $edges = [];
        foreach ($relations as $r) {
            if (isset($index[$r['from_table']], $index[$r['to_table']])) {
                $edges[] = [$index[$r['from_table']], $index[$r['to_table']]];
            }
        }

        return [
            'table_count' => count($tables),
            'view_count' => $views,
            'preview' => ['nodes' => $nodes, 'edges' => $edges],
        ];
    }
}
