<?php

namespace App\Http\Requests;

use App\Enums\TransferMethod;
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
            // The browser's IANA zone, for the time in the file name.
            'timezone' => ['sometimes', 'nullable', 'string', 'max:64', 'timezone:all'],
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
            if ($validator->errors()->hasAny(['structure', 'data'])) {
                return;
            }
            if (! $this->boolean('structure') && ! $this->boolean('data')) {
                $validator->errors()->add('data', 'Include the structure, the data or both.');
            }
        }];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['tables.in' => "Choose 'all' or a list of tables.", 'tables.max' => self::TOO_MANY_TABLES];
    }
}
