<?php

namespace App\Http\Requests;

use App\Enums\TransferMethod;
use App\Transfers\Export\ExportOptions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * A backup request. Whether each chosen table exists is checked by the controller, which has the connection.
 */
class StartExportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * The most tables one backup (or capabilities read) may name. More would hit MySQL's 65,535 placeholders per
     * statement in the native FLOAT check; past this, backing up everything is the sensible choice anyway.
     */
    public const MAX_TABLES = 10_000;

    public const TOO_MANY_TABLES = 'Choose at most 10,000 tables, or back up all of them';

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $rules = [
            'tables' => ['required'],
            'structure' => ['required', 'boolean'],
            'data' => ['required', 'boolean'],
            'drop' => ['sometimes', 'boolean'],
            'gzip' => ['sometimes', 'boolean'],
            'method' => ['nullable', Rule::enum(TransferMethod::class)],
            'table_modes' => ['sometimes'],
        ];

        if (is_array($this->input('tables'))) {
            $rules['tables'] = ['required', 'array', 'list', 'max:'.self::MAX_TABLES];
            $rules['tables.*'] = ['required', 'string', 'distinct', 'max:1000'];
        } else {
            $rules['tables'][] = Rule::in(['all']);
        }

        return $rules;
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($this->has('table_modes') && ! $validator->errors()->has('table_modes')) {
                $error = self::validateTableModes($this->input('table_modes'), $this->input('tables'));
                if ($error !== null) {
                    $validator->errors()->add('table_modes', $error);
                }
            }
            if ($validator->errors()->hasAny(['structure', 'data'])) {
                return;
            }
            if (! $this->boolean('structure') && ! $this->boolean('data')) {
                $validator->errors()->add('data', 'Include the structure, the data or both.');
            }
        }];
    }

    /** An error message when $modes is not a valid per-table mode map for the chosen $tables, else null. */
    public static function validateTableModes(mixed $modes, mixed $tables): ?string
    {
        if (! is_array($tables) || ! array_is_list($tables)) {
            return 'Per-table modes need a list of chosen tables.';
        }
        if (! is_array($modes) || ($modes !== [] && array_is_list($modes))) {
            return 'Per-table modes must map each table to a mode.';
        }
        if (count($modes) > self::MAX_TABLES) {
            return self::TOO_MANY_TABLES;
        }
        foreach ($modes as $key => $mode) {
            if (! in_array((string) $key, $tables, true)) {
                return 'Per-table modes name a table that is not chosen.';
            }
            if (! in_array($mode, ExportOptions::MODES, true)) {
                return 'A table mode must be both, structure or data.';
            }
        }

        return null;
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['tables.in' => "Choose 'all' or a list of tables.", 'tables.max' => self::TOO_MANY_TABLES];
    }
}
