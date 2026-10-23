import type {
    ConnectionFormData,
    ConnectionOptions,
    DriverValue,
    MySqlSslMode,
} from '@/types/connection';

export function isServerDriver(driver: DriverValue): boolean {
    return driver !== 'sqlite';
}

export function defaultsFor(driver: DriverValue): Partial<ConnectionFormData> {
    switch (driver) {
        case 'mysql':
        case 'mariadb':
            return {
                host: '127.0.0.1',
                port: 3306,
                username: 'root',
                options: {},
            };
        case 'pgsql':
            return {
                host: '127.0.0.1',
                port: 5432,
                username: 'postgres',
                options: { sslmode: 'prefer', schema: 'public' },
            };
        case 'sqlite':
            return {
                host: '',
                port: null,
                username: '',
                password: '',
                options: {},
            };
    }
}

/** The MySQL/MariaDB SSL modes in form order, with their label and one-line hint. */
export const MYSQL_SSL_MODES: {
    value: MySqlSslMode;
    label: string;
    hint: string;
}[] = [
    {
        value: 'disabled',
        label: 'Disabled',
        hint: 'Connects without encryption.',
    },
    {
        value: 'required',
        label: 'Required — encrypted, certificate not checked',
        hint: 'Encrypts the connection but accepts any server certificate — use it through an SSH tunnel or when the host name differs.',
    },
    {
        value: 'verify_identity',
        label: 'Verify identity — CA file and host name checked',
        hint: 'The certificate must be signed by the CA file below and its host name must match the host.',
    },
];

/**
 * The SSL mode a MySQL/MariaDB connection uses. Connections saved before the mode existed have none: a CA path
 * meant verify identity (unless ssl_verify was false, which only encrypted), no CA path meant disabled.
 * Mirrors App\Enums\MySqlSslMode::effective().
 */
export function mysqlSslMode(options: ConnectionOptions): MySqlSslMode {
    if (options.mysql_ssl) return options.mysql_ssl;
    if (!options.ssl_ca) return 'disabled';
    // PHP's (bool) cast of the stored flag: false, 0, '0' and '' turn verification off.
    const verify = options.ssl_verify as unknown;
    return verify === false || verify === 0 || verify === '0' || verify === ''
        ? 'required'
        : 'verify_identity';
}

/** Laravel validation errors (field → messages) to the first message per field, as useForm expects. */
export function firstErrors(errors: unknown): Record<string, string> {
    if (typeof errors !== 'object' || errors === null) return {};

    const result: Record<string, string> = {};
    for (const [field, messages] of Object.entries(errors)) {
        if (Array.isArray(messages) && typeof messages[0] === 'string') {
            result[field] = messages[0];
        } else if (typeof messages === 'string') {
            result[field] = messages;
        }
    }
    return result;
}

/** What to tell the user when the test-connection request itself fails (status null: network error). */
export function testFailureMessage(status: number | null): string {
    switch (status) {
        case 422:
            return 'Please fix the highlighted fields first.';
        case 419:
            return 'Your session expired — reload the page.';
        case 429:
            return 'Too many attempts — wait a moment.';
        default:
            return 'Test request failed.';
    }
}
