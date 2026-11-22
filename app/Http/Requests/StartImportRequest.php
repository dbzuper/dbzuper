<?php

namespace App\Http\Requests;

use App\Database\Query\HistoryRecorder;
use App\Enums\TransferMethod;
use App\Models\SavedConnection;
use App\Transfers\TransferPlanner;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * A restore request: the file is described here and its bytes follow in chunks. The user must type the name of the
 * database the restore goes into, and a read-only connection can't restore at all.
 */
class StartImportRequest extends FormRequest
{
    public function authorize(): bool
    {
        if ($this->user() === null) {
            return false;
        }

        $connection = $this->connection();
        Gate::authorize('view', $connection);
        if ($connection->read_only) {
            throw new AuthorizationException('This connection is read-only.');
        }

        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'file_name' => ['required', 'string', 'max:255'],
            'size' => ['required', 'integer', 'min:1', 'max:'.$this->maxBytes()],
            'method' => ['nullable', Rule::enum(TransferMethod::class)],
            'confirm' => ['required', 'string'],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $name = app(TransferPlanner::class)->databaseName($this->connection());
            if (! $validator->errors()->has('confirm') && $this->input('confirm') !== $name) {
                $validator->errors()->add('confirm', $this->confirmMessage($name));
            }
        }];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'size.max' => 'The file is larger than the limit of '.HistoryRecorder::bytesForHumans($this->maxBytes()),
            'size.min' => 'The file is empty.',
            'confirm.required' => $this->confirmMessage(app(TransferPlanner::class)->databaseName($this->connection())),
        ];
    }

    /** The name the browser sent, without any folders or control characters. */
    public function fileName(): string
    {
        $name = basename(str_replace('\\', '/', (string) $this->validated('file_name')));
        $name = trim((string) preg_replace('~[\x00-\x1F\x7F]+~u', '_', $name));

        return $name === '' ? 'upload.sql' : $name;
    }

    private function confirmMessage(string $name): string
    {
        return "Type {$name} to confirm";
    }

    private function maxBytes(): int
    {
        return (int) config('dbzuper.transfer_max_bytes');
    }

    private function connection(): SavedConnection
    {
        $connection = $this->route('connection');
        abort_unless($connection instanceof SavedConnection, 404);

        return $connection;
    }
}
