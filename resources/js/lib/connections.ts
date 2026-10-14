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
