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

    /** The legacy single-object sort becomes a one-key list. */
    protected function prepareForValidation(): void
    {
        $sort = $this->input('sort');
        if (is_array($sort) && array_key_exists('column', $sort)) {
            $this->merge(['sort' => [$sort]]);
        }
    }

    /** @return array<string, mixed> */
    public static function filterRules(): array
    {
        return [
            'filters' => ['sometimes', 'array', 'max:20'],
            'filters.*.column' => ['required', 'string', 'max:255'],
            'filters.*.op' => ['required', Rule::in(TableRowsQuery::OPS)],
            // Comparison operators need a value: an empty one would be bound as '' and fail on typed columns.
            'filters.*.value' => ['required_if:filters.*.op,eq,neq,lt,lte,gt,gte,on,between,after', 'nullable', 'string', 'max:1000', 'not_regex:/\x00/'],
            // The end of a `between` range; DateFilters checks its form and rejects it on every other operator.
            'filters.*.to' => ['nullable', 'string', 'max:40'],
        ];
    }

    public function rules(): array
    {
        return self::filterRules() + [
            'sort' => ['sometimes', 'nullable', 'array', 'max:3'],
            'sort.*.column' => ['required', 'string', 'max:255', 'distinct'],
            'sort.*.direction' => ['required', 'in:asc,desc'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'per_page' => ['sometimes', 'integer', 'between:1,1000'],
        ];
    }
}
