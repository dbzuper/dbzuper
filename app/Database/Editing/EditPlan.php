<?php

namespace App\Database\Editing;

final readonly class EditPlan
{
    /**
     * @param  list<string>  $keyColumns  key columns for PrimaryKey/UniqueIndex; empty for rowid, ctid, all-values and None
     * @param  ?string  $reason  why the table can't be edited (None)
     * @param  list<string>  $readOnlyColumns  generated, identity-always and binary columns
     */
    public function __construct(
        public EditMethod $method,
        public array $keyColumns = [],
        public ?string $reason = null,
        public array $readOnlyColumns = [],
    ) {}

    public static function none(string $reason): self
    {
        return new self(EditMethod::None, [], $reason, []);
    }

    public function editable(): bool
    {
        return $this->method !== EditMethod::None;
    }

    public function toArray(): array
    {
        return [
            'method' => $this->method->value,
            'key_columns' => $this->keyColumns,
            'reason' => $this->reason,
            'read_only_columns' => $this->readOnlyColumns,
        ];
    }
}
