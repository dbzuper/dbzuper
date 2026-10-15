<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class QueryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'statements' => ['required', 'array', 'min:1', 'max:50'],
            'statements.*.sql' => ['required', 'string', 'max:200000'],
            'statements.*.confirmed' => ['sometimes', 'boolean'],
            'statements.*.typed' => ['nullable', 'string', 'max:1024'],
            'max_rows' => ['sometimes', 'integer', 'between:1,10000'],
        ];
    }
}
