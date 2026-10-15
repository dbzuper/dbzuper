<?php

namespace App\Database\Records;

use Illuminate\Validation\ValidationException;

final readonly class RecordKey
{
    /** @param array<string, string|int|float> $pairs keyed by column, in primary-key order */
    private function __construct(private array $pairs) {}

    public static function fromJson(string $json, array $table): self
    {
        $decoded = json_decode($json, true, 4, JSON_BIGINT_AS_STRING);
        $pk = $table['primary_key'] ?? [];
        if (! is_array($decoded) || array_is_list($decoded) || $decoded === []) {
            throw ValidationException::withMessages(['key' => 'The key must be a JSON object of primary-key values.']);
        }
        $names = array_map('strval', array_keys($decoded));
        sort($names);
        $expected = $pk;
        sort($expected);
        if ($names !== $expected) {
            throw ValidationException::withMessages(['key' => 'The key must name exactly the primary-key columns: '.implode(', ', $pk).'.']);
        }
        foreach ($decoded as $value) {
            if (! is_string($value) && ! is_int($value) && ! is_float($value)) {
                throw ValidationException::withMessages(['key' => 'Key values must be strings or numbers.']);
            }
        }

        return new self(array_combine($pk, array_map(fn ($c) => $decoded[$c], $pk)));
    }

    /** @param list<string|int|float> $values */
    public static function fromValues(array $table, array $values): self
    {
        return new self(array_combine($table['primary_key'], $values));
    }

    /** @return list<string> */
    public function columns(): array
    {
        return array_map('strval', array_keys($this->pairs));
    }

    /** @return list<string|int|float> */
    public function values(): array
    {
        return array_values($this->pairs);
    }

    /** @return array<string, string|int|float> */
    public function toArray(): array
    {
        return $this->pairs;
    }
}
