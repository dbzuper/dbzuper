<?php

namespace App\Http\Requests;

use App\Database\Drivers\DsnValue;
use App\Database\Exceptions\SqlitePathNotAllowed;
use App\Database\SqlitePathPolicy;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Arr;
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

        $dsn = $this->dsnSafe();

        return [
            'connection_id' => ['nullable', 'integer'],
            'name' => ['required', 'string', 'max:100'],
            'driver' => ['required', Rule::enum(DriverName::class)],
            'host' => [$server, 'nullable', 'string', 'max:255', $dsn],
            'port' => ['nullable', 'integer', 'between:1,65535'],
            'database' => ['required', 'string', 'max:1024', $dsn],
            'username' => [$server, 'nullable', 'string', 'max:255', $dsn],
            'password' => ['nullable', 'string', 'max:1024'],
            'clear_password' => ['sometimes', 'boolean'],
            'options' => ['nullable', 'array'],
            'options.sslmode' => ['nullable', Rule::in(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'])],
            'options.ssl_ca' => ['nullable', 'string', 'max:1024', $dsn],
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
            $existing = $this->route('connection');
            if ($existing instanceof SavedConnection && $existing->user_id === $this->user()?->id
                && ! $validator->errors()->has('password')
                && filled($existing->password)
                && $this->identityChangedFrom($existing)
                && ! filled($this->input('password')) && ! $this->boolean('clear_password')) {
                $validator->errors()->add('password', 'Re-enter the password when changing the server or connection settings.');
            }
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

    /**
     * Mirrors the driver-level DsnValue checks so unsafe values become field errors instead of failing later.
     * Server drivers reject PDO DSN separators; PostgreSQL also rejects libpq conninfo metacharacters.
     * SQLite paths are checked by SqlitePathPolicy instead.
     */
    private function dsnSafe(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) {
            $driver = DriverName::tryFrom((string) $this->input('driver'));
            if ($driver === null || ! $driver->isServer() || ! is_scalar($value)) {
                return;
            }
            $pattern = $driver === DriverName::Postgres ? DsnValue::LIBPQ_UNSAFE : DsnValue::PDO_UNSAFE;
            if (preg_match($pattern, (string) $value)) {
                $fail($driver === DriverName::Postgres
                    ? 'The :attribute may not contain spaces, quotes, backslashes, semicolons or line breaks.'
                    : 'The :attribute may not contain semicolons or line breaks.');
            }
        };
    }

    /**
     * True when this is a server connection and any value that reaches the DSN (driver, host, port, username,
     * database, sslmode, ssl_ca, ssl_verify, schema) differs from the saved one, so the stored password
     * must not be reused without being re-entered.
     */
    public function identityChangedFrom(SavedConnection $existing): bool
    {
        $driver = DriverName::tryFrom((string) $this->input('driver'));
        if ($driver === null || ! $driver->isServer()) {
            return false;
        }
        $port = $this->input('port') ?: $driver->defaultPort();

        return $existing->driver !== $driver
            || (string) $existing->host !== (string) $this->input('host')
            || (int) ($existing->port ?: $existing->driver->defaultPort()) !== (int) $port
            || (string) $existing->username !== (string) $this->input('username')
            || (string) $existing->database !== (string) $this->input('database')
            || self::dsnOptions((array) ($existing->options ?? [])) !== self::dsnOptions((array) $this->input('options', []));
    }

    /**
     * DSN-relevant options with the driver defaults applied, so resubmitting a default is not a change.
     *
     * @return array{sslmode: string, ssl_ca: string, ssl_verify: bool, schema: string}
     */
    private static function dsnOptions(array $options): array
    {
        $value = fn (string $key) => ($options[$key] ?? null) === '' ? null : ($options[$key] ?? null);

        return [
            'sslmode' => (string) ($value('sslmode') ?? 'prefer'),
            'ssl_ca' => (string) ($value('ssl_ca') ?? ''),
            'ssl_verify' => filter_var($value('ssl_verify') ?? true, FILTER_VALIDATE_BOOLEAN),
            'schema' => (string) ($value('schema') ?? 'public'),
        ];
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
            'options' => array_filter(Arr::only((array) $this->input('options', []), ['sslmode', 'ssl_ca', 'ssl_verify', 'schema']), fn ($v) => $v !== null && $v !== ''),
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
