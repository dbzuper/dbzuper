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

        if ($modes !== [] && count(array_unique($modes)) === 1) {
            $only = reset($modes);
            $structure = $only !== 'data';
            $data = $only !== 'structure';
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

    /** @return list<'both'|'structure'|'data'> the distinct effective modes over the chosen tables */
    public function modeKinds(): array
    {
        $kinds = [];
        foreach ($this->tables ?? [] as $key) {
            $kinds[] = $this->structureFor($key) ? ($this->dataFor($key) ? 'both' : 'structure') : 'data';
        }

        return array_values(array_unique($kinds));
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
