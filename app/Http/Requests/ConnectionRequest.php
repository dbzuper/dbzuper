<?php

namespace App\Http\Requests;

use App\Database\Exceptions\SqlitePathNotAllowed;
use App\Database\SqlitePathPolicy;
use App\Enums\DriverName;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ConnectionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        $server = Rule::requiredIf(fn () => $this->input('driver') !== DriverName::Sqlite->value);

        return [
            'connection_id' => ['nullable', 'integer'],
            'name' => ['required', 'string', 'max:100'],
            'driver' => ['required', Rule::enum(DriverName::class)],
            'host' => [$server, 'nullable', 'string', 'max:255'],
            'port' => ['nullable', 'integer', 'between:1,65535'],
            'database' => ['required', 'string', 'max:1024'],
            'username' => [$server, 'nullable', 'string', 'max:255'],
            'password' => ['nullable', 'string', 'max:1024'],
            'clear_password' => ['sometimes', 'boolean'],
            'options' => ['nullable', 'array'],
            'options.sslmode' => ['nullable', Rule::in(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'])],
            'options.ssl_ca' => ['nullable', 'string', 'max:1024'],
            'options.ssl_verify' => ['nullable', 'boolean'],
            'options.schema' => ['nullable', 'string', 'max:63', 'regex:/^[A-Za-z_][A-Za-z0-9_$]*$/'],
            'read_only' => ['sometimes', 'boolean'],
            'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'store_history' => ['sometimes', 'boolean'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($this->input('driver') !== DriverName::Sqlite->value || $validator->errors()->has('database')) {
                return;
            }
            try {
                app(SqlitePathPolicy::class)->resolve((string) $this->input('database'));
            } catch (SqlitePathNotAllowed $e) {
                $validator->errors()->add('database', $e->getMessage());
            } catch (\ValueError) {
                $validator->errors()->add('database', 'The SQLite path is not valid.');
            }
        }];
    }

    /** Attributes to persist. A blank password means "unchanged" unless clear_password is set. */
    public function connectionAttributes(): array
    {
        $driver = DriverName::from($this->input('driver'));
        $attributes = [
            'name' => $this->input('name'),
            'driver' => $driver,
            'host' => $driver->isServer() ? $this->input('host') : null,
            'port' => $driver->isServer() ? ($this->input('port') ?: $driver->defaultPort()) : null,
            'database' => $this->input('database'),
            'username' => $driver->isServer() ? $this->input('username') : null,
            'options' => array_filter((array) $this->input('options', []), fn ($v) => $v !== null && $v !== ''),
            'read_only' => $this->boolean('read_only'),
            'color' => $this->input('color'),
            'store_history' => $this->boolean('store_history', true),
        ];

        if ($this->boolean('clear_password') || ! $driver->isServer()) {
            $attributes['password'] = null;
        } elseif (filled($this->input('password'))) {
            $attributes['password'] = $this->input('password');
        }

        return $attributes;
    }
}
