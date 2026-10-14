import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    defaultsFor,
    firstErrors,
    isServerDriver,
    testFailureMessage,
} from '@/lib/connections';
import { ApiError, apiFetch } from '@/lib/http';
import type {
    ConnectionFormData,
    ConnectionSummary,
    ConnectionTestResult,
    DriverChoice,
    DriverValue,
} from '@/types/connection';
import { useForm } from '@inertiajs/react';
import { type FormEvent, useState } from 'react';

const inputClass =
    'h-9 rounded-md border border-input bg-transparent px-3 text-sm';

export function ConnectionForm({
    connection,
    drivers,
}: {
    connection: ConnectionSummary | null;
    drivers: DriverChoice[];
}) {
    const form = useForm<ConnectionFormData>({
        connection_id: connection?.id ?? null,
        name: connection?.name ?? '',
        driver: connection?.driver ?? 'mysql',
        host: connection?.host ?? '127.0.0.1',
        port: connection?.port ?? 3306,
        database: connection?.database ?? '',
        username: connection?.username ?? 'root',
        password: '',
        clear_password: false,
        options: connection?.options ?? {},
        read_only: connection?.read_only ?? false,
        color: connection?.color ?? '#14b8a6',
        store_history: connection?.store_history ?? true,
    });
    const [test, setTest] = useState<ConnectionTestResult | null>(null);
    const [testing, setTesting] = useState(false);
    const server = isServerDriver(form.data.driver);

    const changeDriver = (driver: DriverValue) =>
        form.setData({ ...form.data, ...defaultsFor(driver), driver });

    const runTest = async () => {
        setTesting(true);
        setTest(null);
        form.clearErrors();
        try {
            setTest(
                await apiFetch<ConnectionTestResult>('/connections/test', {
                    method: 'POST',
                    body: form.data,
                }),
            );
        } catch (e) {
            const status = e instanceof ApiError ? e.status : null;
            if (e instanceof ApiError && e.status === 422) {
                form.setError(
                    firstErrors(
                        (e.body as { errors?: unknown } | null)?.errors,
                    ) as Partial<Record<keyof ConnectionFormData, string>>,
                );
            }
            const message = testFailureMessage(status);
            setTest({
                ok: false,
                version: null,
                latency_ms: 0,
                error: {
                    kind: 'unknown',
                    message,
                    sqlstate: null,
                    reason: null,
                },
            });
        } finally {
            setTesting(false);
        }
    };

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (connection) form.put(`/connections/${connection.id}`);
        else form.post('/connections');
    };

    const field = (
        name: keyof ConnectionFormData,
        label: string,
        props: Record<string, unknown> = {},
    ) => (
        <div className="grid gap-2">
            <Label htmlFor={name}>{label}</Label>
            <Input
                id={name}
                value={(form.data[name] as string | number | null) ?? ''}
                onChange={(e) =>
                    form.setData(
                        name,
                        (props.type === 'number'
                            ? e.target.value === ''
                                ? null
                                : Number(e.target.value)
                            : e.target.value) as never,
                    )
                }
                {...props}
            />
            <InputError message={form.errors[name]} />
        </div>
    );

    return (
        <form onSubmit={submit} className="grid max-w-2xl gap-6">
            {field('name', 'Name', {
                required: true,
                placeholder: 'Production',
            })}

            <div className="grid gap-2">
                <Label htmlFor="driver">Engine</Label>
                <select
                    id="driver"
                    className={inputClass}
                    value={form.data.driver}
                    onChange={(e) =>
                        changeDriver(e.target.value as DriverValue)
                    }
                >
                    {drivers.map((d) => (
                        <option key={d.value} value={d.value}>
                            {d.label}
                        </option>
                    ))}
                </select>
                <InputError message={form.errors.driver} />
            </div>

            {server ? (
                <>
                    <div className="grid grid-cols-[1fr_8rem] gap-4">
                        {field('host', 'Host', { required: true })}
                        {field('port', 'Port', { type: 'number' })}
                    </div>
                    {field('database', 'Database', { required: true })}
                    <div className="grid grid-cols-2 gap-4">
                        {field('username', 'Username', { autoComplete: 'off' })}
                        {field('password', 'Password', {
                            type: 'password',
                            autoComplete: 'new-password',
                            placeholder: connection?.has_password
                                ? '•••••• unchanged'
                                : '',
                        })}
                    </div>
                    {connection?.has_password && (
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={form.data.clear_password}
                                onChange={(e) =>
                                    form.setData(
                                        'clear_password',
                                        e.target.checked,
                                    )
                                }
                            />
                            Remove the stored password
                        </label>
                    )}
                    {form.data.driver === 'pgsql' ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="sslmode">SSL mode</Label>
                                <select
                                    id="sslmode"
                                    className={inputClass}
                                    value={
                                        form.data.options.sslmode ?? 'prefer'
                                    }
                                    onChange={(e) =>
                                        form.setData('options', {
                                            ...form.data.options,
                                            sslmode: e.target.value as never,
                                        })
                                    }
                                >
                                    {[
                                        'disable',
                                        'allow',
                                        'prefer',
                                        'require',
                                        'verify-ca',
                                        'verify-full',
                                    ].map((m) => (
                                        <option key={m}>{m}</option>
                                    ))}
                                </select>
                                <InputError
                                    message={
                                        form.errors[
                                            'options.sslmode' as keyof ConnectionFormData
                                        ]
                                    }
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="schema">Schema</Label>
                                <Input
                                    id="schema"
                                    value={form.data.options.schema ?? 'public'}
                                    onChange={(e) =>
                                        form.setData('options', {
                                            ...form.data.options,
                                            schema: e.target.value,
                                        })
                                    }
                                />
                                <InputError
                                    message={
                                        form.errors[
                                            'options.schema' as keyof ConnectionFormData
                                        ]
                                    }
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-2">
                            <Label htmlFor="ssl_ca">
                                TLS CA certificate path (optional)
                            </Label>
                            <Input
                                id="ssl_ca"
                                value={form.data.options.ssl_ca ?? ''}
                                onChange={(e) =>
                                    form.setData('options', {
                                        ...form.data.options,
                                        ssl_ca: e.target.value,
                                    })
                                }
                            />
                            <InputError
                                message={
                                    form.errors[
                                        'options.ssl_ca' as keyof ConnectionFormData
                                    ]
                                }
                            />
                        </div>
                    )}
                </>
            ) : (
                field('database', 'SQLite file path', {
                    required: true,
                    placeholder: '/data/app.sqlite',
                })
            )}

            <div className="flex flex-wrap items-center gap-6 text-sm">
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={form.data.read_only}
                        onChange={(e) =>
                            form.setData('read_only', e.target.checked)
                        }
                    />
                    Read-only (enforced by the database)
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={form.data.store_history}
                        onChange={(e) =>
                            form.setData('store_history', e.target.checked)
                        }
                    />
                    Keep query history
                </label>
                <label className="flex items-center gap-2">
                    Colour
                    <input
                        type="color"
                        value={form.data.color}
                        onChange={(e) => form.setData('color', e.target.value)}
                    />
                </label>
            </div>

            {test && (
                <div
                    role="status"
                    className={`rounded-md border px-3 py-2 text-sm ${test.ok ? 'border-teal-500/40 text-teal-600 dark:text-teal-400' : 'border-red-500/40 text-red-600 dark:text-red-400'}`}
                >
                    {test.ok
                        ? `Connected · ${test.version} · ${test.latency_ms} ms`
                        : test.error?.message}
                </div>
            )}

            <div className="flex gap-3">
                <Button
                    type="button"
                    variant="outline"
                    onClick={runTest}
                    disabled={testing}
                >
                    {testing ? 'Testing…' : 'Test connection'}
                </Button>
                <Button type="submit" disabled={form.processing}>
                    {connection ? 'Save changes' : 'Add connection'}
                </Button>
            </div>
        </form>
    );
}
