<?php

namespace App\Transfers\Export;

final readonly class ExportOptions
{
    /** @param list<string>|null $tables DumpObject::key() values; null = every table and view */
    public function __construct(
        public ?array $tables,
        public bool $structure,
        public bool $data,
        public bool $dropFirst,
        public bool $gzip,
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

        return new self(
            tables: $tables,
            structure: (bool) ($validated['structure'] ?? true),
            data: (bool) ($validated['data'] ?? true),
            dropFirst: (bool) ($validated['drop'] ?? false),
            gzip: (bool) ($validated['gzip'] ?? false),
        );
    }

    /** @return array{tables: list<string>|null, structure: bool, data: bool, drop: bool, gzip: bool} */
    public function toArray(): array
    {
        return [
            'tables' => $this->tables,
            'structure' => $this->structure,
            'data' => $this->data,
            'drop' => $this->dropFirst,
            'gzip' => $this->gzip,
        ];
    }
}
