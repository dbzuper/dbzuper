import type { ConnectionFormData, DriverValue } from '@/types/connection';

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
