<?php

namespace App\Transfers\Export;

final readonly class DumpObject
{
    /** @param 'table'|'view' $kind */
    public function __construct(
        public ?string $schema,
        public string $name,
        public string $kind,
    ) {}

    /** Stable identifier: the bare name without a schema, otherwise a JSON `[schema, name]` pair. */
    public function key(): string
    {
        return $this->schema === null
            ? $this->name
            : json_encode([$this->schema, $this->name], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** @return array{schema: ?string, name: string, kind: string, key: string} */
    public function toArray(): array
    {
        return ['schema' => $this->schema, 'name' => $this->name, 'kind' => $this->kind, 'key' => $this->key()];
    }
}
