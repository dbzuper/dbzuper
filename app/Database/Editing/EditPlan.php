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

    /** A plan stored by toArray(), or null when the cache entry isn't one, so the caller resolves the plan afresh. */
    public static function fromCached(mixed $data): ?self
    {
        if (! is_array($data) || ! is_string($data['method'] ?? null)) {
            return null;
        }
        $method = EditMethod::tryFrom($data['method']);
        $keyColumns = self::stringList($data['key_columns'] ?? []);
        $readOnlyColumns = self::stringList($data['read_only_columns'] ?? []);
        $nonComparableColumns = self::stringList($data['non_comparable_columns'] ?? []);
        $reason = $data['reason'] ?? null;
        if ($method === null || $keyColumns === null || $readOnlyColumns === null || $nonComparableColumns === null
            || ($reason !== null && ! is_string($reason))) {
            return null;
        }

        return new self($method, $keyColumns, $reason, $readOnlyColumns, (bool) ($data['needs_tableoid'] ?? false), $nonComparableColumns);
    }

    /** @return ?list<string> */
    private static function stringList(mixed $value): ?array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            return null;
        }
        $strings = array_values(array_filter($value, is_string(...)));

        return count($strings) === count($value) ? $strings : null;
    }

    /** @return array{method: string, key_columns: list<string>, reason: ?string, read_only_columns: list<string>, needs_tableoid: bool, non_comparable_columns: list<string>} */
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
