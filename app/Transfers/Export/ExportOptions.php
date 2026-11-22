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
        $tables = $validated['tables'] ?? null;

        return new self(
            tables: is_array($tables) ? array_values(array_map('strval', $tables)) : null,
            structure: (bool) ($validated['structure'] ?? true),
            data: (bool) ($validated['data'] ?? true),
            dropFirst: (bool) ($validated['drop_first'] ?? false),
            gzip: (bool) ($validated['gzip'] ?? false),
        );
    }

    /** @return array{tables: list<string>|null, structure: bool, data: bool, drop_first: bool, gzip: bool} */
    public function toArray(): array
    {
        return [
            'tables' => $this->tables,
            'structure' => $this->structure,
            'data' => $this->data,
            'drop_first' => $this->dropFirst,
            'gzip' => $this->gzip,
        ];
    }
}
