<?php

namespace App\Transfers\Export;

final readonly class ExportOptions
{
    public const MODES = ['both', 'structure', 'data'];

    /**
     * @param  list<string>|null  $tables  DumpObject::key() values; null = every table and view
     * @param  array<string, 'both'|'structure'|'data'>  $modes  the per-table mode of every chosen table, empty unless the
     *                                                           tables differ; keys without a mode (views) use the globals
     */
    public function __construct(
        public ?array $tables,
        public bool $structure,
        public bool $data,
        public bool $dropFirst,
        public bool $gzip,
        public array $modes = [],
    ) {}

    /** @param array<string, mixed> $validated */
    public static function fromRequest(array $validated): self
    {
        $tables = $validated['tables'] ?? 'all';
        if ($tables === 'all') {
            $tables = null;
        } elseif (! is_array($tables) || ! array_is_list($tables) || array_filter($tables, fn ($t) => ! is_string($t)) !== []) {
            throw new \InvalidArgumentException("tables must be 'all' or a list of strings");
        }

        $structure = (bool) ($validated['structure'] ?? true);
        $data = (bool) ($validated['data'] ?? true);
        $modes = $validated['table_modes'] ?? [];
        if (! is_array($modes) || array_filter($modes, fn ($m) => ! in_array($m, self::MODES, true)) !== []) {
            throw new \InvalidArgumentException('table_modes must map tables to both, structure or data');
        }

        // Every mode equal to the globals' mode: nothing is per table, so the request runs exactly as without a map.
        // A single mode that differs from the globals is still a mix, since keys without a mode keep the globals.
        if ($modes !== [] && array_unique($modes) === [array_key_first($modes) => self::modeOf($structure, $data)]) {
            $modes = [];
        }

        return new self(
            tables: $tables,
            structure: $structure,
            data: $data,
            dropFirst: (bool) ($validated['drop'] ?? false),
            gzip: (bool) ($validated['gzip'] ?? false),
            modes: $modes,
        );
    }

    public function structureFor(string $key): bool
    {
        return isset($this->modes[$key]) ? $this->modes[$key] !== 'data' : $this->structure;
    }

    public function dataFor(string $key): bool
    {
        return isset($this->modes[$key]) ? $this->modes[$key] !== 'structure' : $this->data;
    }

    public function anyStructure(): bool
    {
        return $this->structure || in_array('both', $this->modes, true) || in_array('structure', $this->modes, true);
    }

    public function anyData(): bool
    {
        return $this->data || in_array('both', $this->modes, true) || in_array('data', $this->modes, true);
    }

    public function isMixed(): bool
    {
        return $this->modes !== [];
    }

    /**
     * The distinct per-table modes of a mix; [] when not mixed. Only the map counts: views and other keys without
     * a mode take the globals, which a native run applies to them as it does without a mix.
     *
     * @return list<'both'|'structure'|'data'>
     */
    public function modeKinds(): array
    {
        return array_values(array_unique($this->modes));
    }

    /** @return 'both'|'structure'|'data'|null the mode the global flags describe; null when neither is on */
    private static function modeOf(bool $structure, bool $data): ?string
    {
        return match (true) {
            $structure && $data => 'both',
            $structure => 'structure',
            $data => 'data',
            default => null,
        };
    }

    /** @return array{tables: list<string>|null, structure: bool, data: bool, drop: bool, gzip: bool, table_modes: array<string, 'both'|'structure'|'data'>} */
    public function toArray(): array
    {
        return [
            'tables' => $this->tables,
            'structure' => $this->structure,
            'data' => $this->data,
            'drop' => $this->dropFirst,
            'gzip' => $this->gzip,
            'table_modes' => $this->modes,
        ];
    }
}
