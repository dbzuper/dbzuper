<?php

namespace App\Http\Requests;

use App\Database\Drivers\DsnValue;
use App\Database\Exceptions\SqlitePathNotAllowed;
use App\Database\SqlitePathPolicy;
use App\Enums\DriverName;
use App\Enums\MySqlSslMode;
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
        $sqlite = Rule::requiredIf(fn () => $this->input('driver') === DriverName::Sqlite->value);

        $dsn = $this->dsnSafe();

        return [
            'connection_id' => ['nullable', 'integer'],
            'name' => ['required', 'string', 'max:100'],
            'driver' => ['required', Rule::enum(DriverName::class)],
            'host' => [$server, 'nullable', 'string', 'max:255', $dsn],
            'port' => ['nullable', 'integer', 'between:1,65535'],
            // Blank for a server driver: a server-level connection that can open every database.
            'database' => [$sqlite, 'nullable', 'string', 'max:1024', $dsn],
            'username' => [$server, 'nullable', 'string', 'max:255', $dsn],
            'password' => ['nullable', 'string', 'max:1024'],
            'clear_password' => ['sometimes', 'boolean'],
            'options' => ['nullable', 'array'],
            'options.sslmode' => ['nullable', Rule::in(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'])],
            'options.mysql_ssl' => ['nullable', Rule::enum(MySqlSslMode::class)],
            'options.ssl_ca' => [
                Rule::requiredIf(fn () => $this->mySqlFamily() && $this->input('options.mysql_ssl') === MySqlSslMode::VerifyIdentity->value),
                'nullable', 'string', 'max:1024', $dsn,
            ],
            'options.ssl_verify' => ['nullable', 'boolean'],
            'options.schema' => ['nullable', 'string', 'max:63', 'regex:/^[A-Za-z_][A-Za-z0-9_$]*$/'],
            'read_only' => ['sometimes', 'boolean'],
            'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'store_history' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return ['options.ssl_ca.required' => 'Enter the path of the CA certificate file to verify the server identity.'];
    }

    private function mySqlFamily(): bool
    {
        return in_array($this->input('driver'), [DriverName::MySql->value, DriverName::MariaDb->value], true);
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
     * database, sslmode, the MySQL SSL mode, ssl_ca, schema) differs from the saved one, so the stored password
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
            || self::dsnOptions($driver, (array) ($existing->options ?? [])) !== self::dsnOptions($driver, (array) $this->input('options', []));
    }

    /**
     * DSN-relevant options as the driver applies them, so resubmitting a default (or spelling out the SSL mode a
     * saved MySQL connection already behaved as) is not a change. For MySQL/MariaDB the SSL mode covers the
     * legacy ssl_verify flag, and the CA path only counts when the mode verifies against it.
     *
     * @return array{sslmode: string, mysql_ssl: string, ssl_ca: string, schema: string}
     */
    private static function dsnOptions(DriverName $driver, array $options): array
    {
        $value = fn (string $key) => ($options[$key] ?? null) === '' ? null : ($options[$key] ?? null);
        $mySqlSsl = MySqlSslMode::effective($options);
        $caUsed = $driver === DriverName::Postgres || $mySqlSsl === MySqlSslMode::VerifyIdentity->value;

        return [
            'sslmode' => (string) ($value('sslmode') ?? 'prefer'),
            'mysql_ssl' => $driver === DriverName::Postgres ? '' : $mySqlSsl,
            'ssl_ca' => $caUsed ? (string) ($value('ssl_ca') ?? '') : '',
            'schema' => (string) ($value('schema') ?? 'public'),
        ];
    }

    /**
     * Known option keys with blanks removed. An explicit MySQL SSL mode replaces the legacy ssl_verify flag and
     * keeps the CA path only when it verifies against it; other drivers never store a MySQL SSL mode.
     */
    private static function persistedOptions(DriverName $driver, array $input): array
    {
        $options = array_filter(Arr::only($input, ['sslmode', 'ssl_ca', 'ssl_verify', 'schema', 'mysql_ssl']), fn ($v) => $v !== null && $v !== '');
        if (! in_array($driver, [DriverName::MySql, DriverName::MariaDb], true)) {
            unset($options['mysql_ssl']);
        } elseif (isset($options['mysql_ssl'])) {
            unset($options['ssl_verify']);
            if ($options['mysql_ssl'] !== MySqlSslMode::VerifyIdentity->value) {
                unset($options['ssl_ca']);
            }
        }

        return $options;
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
            'database' => filled($this->input('database')) ? $this->input('database') : null,
            'username' => $driver->isServer() ? $this->input('username') : null,
            'options' => self::persistedOptions($driver, (array) $this->input('options', [])),
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
