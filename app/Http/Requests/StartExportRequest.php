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
        ];

        if (is_array($this->input('tables'))) {
            $rules['tables'] = ['required', 'array', 'list', 'max:100000'];
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
        return ['tables.in' => "Choose 'all' or a list of tables."];
    }
}
