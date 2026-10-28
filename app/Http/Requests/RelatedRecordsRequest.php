<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RelatedRecordsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'key' => ['required', 'string', 'max:8192'],
            'rel' => ['required', 'string', 'max:2048'],
            'dir' => ['required', 'in:out,in'],
            'limit' => ['sometimes', 'integer', 'between:1,100'],
            'cursor' => ['sometimes', 'nullable', 'string', 'max:12000'],
        ];
    }
}
