import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionSummary, DriverChoice } from '@/types/connection';

// useForm backed by component state, so the form re-renders as fields change.
vi.mock('@inertiajs/react', () => ({
    useForm: <T extends Record<string, unknown>>(initial: T) => {
        const [data, setDataState] = useState(initial);
        return {
            data,
            setData: (key: keyof T | T, value?: unknown) =>
                setDataState((d) =>
                    typeof key === 'object' ? key : { ...d, [key]: value },
                ),
            errors: {},
            processing: false,
            clearErrors: vi.fn(),
            setError: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
        };
    },
}));

import { ConnectionForm } from './connection-form';

const drivers: DriverChoice[] = [
    { value: 'mysql', label: 'MySQL', default_port: 3306 },
    { value: 'mariadb', label: 'MariaDB', default_port: 3306 },
    { value: 'pgsql', label: 'PostgreSQL', default_port: 5432 },
    { value: 'sqlite', label: 'SQLite', default_port: null },
];

function saved(overrides: Partial<ConnectionSummary>): ConnectionSummary {
    return {
        id: 1,
        ref: '1',
        name: 'Prod',
        driver: 'mysql',
        driver_label: 'MySQL',
        host: '127.0.0.1',
        port: 3306,
        database: 'shop',
        username: 'app',
        has_password: true,
        options: {},
        read_only: false,
        color: null,
        store_history: true,
        last_opened_at: null,
        server_level: false,
        last_database: null,
        ...overrides,
    };
}

const sslSelect = () =>
    screen.queryByLabelText('SSL mode') as HTMLSelectElement | null;
const caField = () => screen.queryByLabelText(/CA certificate/);

describe('ConnectionForm SSL mode', () => {
    it.each(['mysql', 'mariadb'] as const)(
        'offers the MySQL SSL modes for %s, defaulting to disabled',
        (driver) => {
            render(
                <ConnectionForm
                    connection={saved({ driver })}
                    drivers={drivers}
                />,
            );

            const select = sslSelect()!;
            expect(
                Array.from(select.options).map((o) => [o.value, o.text]),
            ).toEqual([
                ['disabled', 'Disabled'],
                ['required', 'Required — encrypted, certificate not checked'],
                [
                    'verify_identity',
                    'Verify identity — CA file and host name checked',
                ],
            ]);
            expect(select.value).toBe('disabled');
            expect(screen.getByText(/without encryption/)).toBeInTheDocument();
            expect(caField()).toBeNull();
        },
    );

    it('shows the CA path only for verify identity, where it is required', () => {
        render(<ConnectionForm connection={null} drivers={drivers} />);

        fireEvent.change(sslSelect()!, { target: { value: 'required' } });
        expect(caField()).toBeNull();
        expect(screen.getByText(/SSH tunnel/)).toBeInTheDocument();

        fireEvent.change(sslSelect()!, {
            target: { value: 'verify_identity' },
        });
        expect(caField()).toBeRequired();
        expect(screen.getByText(/host name must match/)).toBeInTheDocument();
    });

    it('shows how a connection saved before the mode existed behaves', () => {
        render(
            <ConnectionForm
                connection={saved({
                    options: { ssl_ca: '/ca.pem', ssl_verify: false },
                })}
                drivers={drivers}
            />,
        );
        expect(sslSelect()!.value).toBe('required');
    });

    it('keeps a legacy CA path visible as verify identity', () => {
        render(
            <ConnectionForm
                connection={saved({ options: { ssl_ca: '/ca.pem' } })}
                drivers={drivers}
            />,
        );
        expect(sslSelect()!.value).toBe('verify_identity');
        expect(caField()).toHaveValue('/ca.pem');
    });

    it('keeps the PostgreSQL sslmode select instead', () => {
        render(
            <ConnectionForm
                connection={saved({ driver: 'pgsql', options: {} })}
                drivers={drivers}
            />,
        );
        expect(sslSelect()!.value).toBe('prefer');
        expect(screen.queryByText('Verify identity')).toBeNull();
        expect(caField()).toBeNull();
    });

    it('has no SSL mode for SQLite', () => {
        render(
            <ConnectionForm
                connection={saved({ driver: 'sqlite', options: {} })}
                drivers={drivers}
            />,
        );
        expect(sslSelect()).toBeNull();
    });
});

describe('ConnectionForm database', () => {
    it.each(['mysql', 'mariadb', 'pgsql'] as const)(
        'lets %s connections leave the database empty to browse the server',
        (driver) => {
            render(
                <ConnectionForm
                    connection={saved({
                        driver,
                        database: null,
                        server_level: true,
                    })}
                    drivers={drivers}
                />,
            );
            const input = screen.getByLabelText('Database');
            expect(input).not.toBeRequired();
            expect(input).toHaveValue('');
            expect(input).toHaveAccessibleDescription(
                "Leave empty to browse every database on the server. A filled-in database limits this connection to it in DBZuper; the database user's permissions are what actually restrict access.",
            );
        },
    );

    it('still requires the SQLite file path', () => {
        render(
            <ConnectionForm
                connection={saved({ driver: 'sqlite', database: '/x.sqlite' })}
                drivers={drivers}
            />,
        );
        expect(screen.getByLabelText('SQLite file path')).toBeRequired();
    });
});
