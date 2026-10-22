<?php

namespace App\Http\Requests;

use App\Database\Editing\ChangeSet;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The outer shape of a change set. Column-keyed maps (`id`, `original`, `values`) are only checked to be objects
 * here: column names may contain dots, which validation rules would read as paths. ChangeSetBuilder validates them.
 * The route skips TrimStrings and ConvertEmptyStringsToNull: values are saved exactly as typed.
 */
class TableChangesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            // Only previews exist so far; committing (preview false) arrives with the commit endpoint work.
            'preview' => ['required', 'accepted'],
            'changes' => ['required', 'array', 'list', 'min:1', 'max:'.ChangeSet::MAX_CHANGES],
            'changes.*' => ['required', 'array'],
            'changes.*.op' => ['required', Rule::in(ChangeSet::OPS)],
            'changes.*.id' => ['sometimes', 'array'],
            'changes.*.original' => ['sometimes', 'array'],
            'changes.*.values' => ['sometimes', 'array'],
        ];
    }

    /** @return list<array> the changes exactly as sent (validated() would rebuild nested maps through dotted paths) */
    public function changes(): array
    {
        return array_values((array) $this->input('changes', []));
    }
}
