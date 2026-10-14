import { describe, expect, it } from 'vitest';
import { defaultsFor, isServerDriver } from './connections';

describe('connection helpers', () => {
    it('knows which drivers are servers', () => {
        expect(isServerDriver('mysql')).toBe(true);
        expect(isServerDriver('pgsql')).toBe(true);
        expect(isServerDriver('sqlite')).toBe(false);
    });

    it('gives per-driver defaults', () => {
        expect(defaultsFor('mysql')).toMatchObject({
            port: 3306,
            host: '127.0.0.1',
        });
        expect(defaultsFor('pgsql')).toMatchObject({
            port: 5432,
            options: { sslmode: 'prefer', schema: 'public' },
        });
        expect(defaultsFor('sqlite')).toMatchObject({
            host: '',
            port: null,
            username: '',
        });
    });
});
