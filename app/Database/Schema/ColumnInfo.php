<?php

namespace App\Database\Schema;

/**
 * @phpstan-import-type LaravelColumn from LaravelSchemaInspector
 *
 * @phpstan-type ColumnArray array{name: string, type: string, type_name: string, nullable: bool, default: ?string, auto_increment: bool, comment: ?string}
 */
final readonly class ColumnInfo
{
    public function __construct(
        public string $name,
        public string $type,
        public string $typeName,
        public bool $nullable,
        public ?string $default,
        public bool $autoIncrement,
        public ?string $comment,
    ) {}

    /** @param LaravelColumn $column */
    public static function fromLaravel(array $column): self
    {
        return new self(
            $column['name'],
            $column['type'],
            $column['type_name'],
            (bool) $column['nullable'],
            $column['default'] === null ? null : (string) $column['default'],
            (bool) $column['auto_increment'],
            $column['comment'] ?? null,
        );
    }

    /** @return ColumnArray */
    public function toArray(): array
    {
        return [
            'name' => $this->name, 'type' => $this->type, 'type_name' => $this->typeName,
            'nullable' => $this->nullable, 'default' => $this->default,
            'auto_increment' => $this->autoIncrement, 'comment' => $this->comment,
        ];
    }
}
