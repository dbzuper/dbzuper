<?php

namespace App\Http\Requests;

use App\Database\Query\TableRowsQuery;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class TableRowsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'filters' => ['sometimes', 'array', 'max:20'],
            'filters.*.column' => ['required', 'string', 'max:255'],
            'filters.*.op' => ['required', Rule::in(TableRowsQuery::OPS)],
            'filters.*.value' => ['nullable', 'string', 'max:1000'],
            'sort' => ['sometimes', 'nullable', 'array'],
            'sort.column' => ['required_with:sort', 'string', 'max:255'],
            'sort.direction' => ['required_with:sort', 'in:asc,desc'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'per_page' => ['sometimes', 'integer', 'between:1,500'],
        ];
    }
}
