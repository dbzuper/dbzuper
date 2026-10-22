<?php

namespace App\Database\Editing;

final readonly class EditPlan
{
    /**
     * @param  list<string>  $keyColumns  key columns for PrimaryKey/UniqueIndex; empty for rowid, ctid, all-values and None
     * @param  ?string  $reason  why the table can't be edited (None)
     * @param  list<string>  $readOnlyColumns  generated, identity-always and binary columns
     * @param  bool  $needsTableoid  PgCtid on a partitioned table or inheritance parent: ctid repeats across children
     * @param  list<string>  $nonComparableColumns  columns the database can't compare with `=` (PostgreSQL types,
     *                                              domains resolved, without a default btree operator class)
     */
    public function __construct(
        public EditMethod $method,
        public array $keyColumns = [],
        public ?string $reason = null,
        public array $readOnlyColumns = [],
        public bool $needsTableoid = false,
        public array $nonComparableColumns = [],
    ) {}

    public static function none(string $reason): self
    {
        return new self(EditMethod::None, [], $reason, []);
    }

    public function editable(): bool
    {
        return $this->method !== EditMethod::None;
    }

    /** @param array{method: string, key_columns?: list<string>, reason?: ?string, read_only_columns?: list<string>, needs_tableoid?: bool, non_comparable_columns?: list<string>} $data */
    public static function fromArray(array $data): self
    {
        return new self(
            EditMethod::from($data['method']),
            $data['key_columns'] ?? [],
            $data['reason'] ?? null,
            $data['read_only_columns'] ?? [],
            (bool) ($data['needs_tableoid'] ?? false),
            $data['non_comparable_columns'] ?? [],
        );
    }

    public function toArray(): array
    {
        return [
            'method' => $this->method->value,
            'key_columns' => $this->keyColumns,
            'reason' => $this->reason,
            'read_only_columns' => $this->readOnlyColumns,
            'needs_tableoid' => $this->needsTableoid,
            'non_comparable_columns' => $this->nonComparableColumns,
        ];
    }
}
