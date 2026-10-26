import { describe, expect, it } from 'vitest';
import {
    defaultsFor,
    firstErrors,
    isServerDriver,
    mysqlSslMode,
    testFailureMessage,
    workspaceUrl,
} from './connections';

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

describe('firstErrors', () => {
    it('keeps the first message per field', () => {
        expect(
            firstErrors({
                password: [
                    'Re-enter the password when changing the server or connection settings.',
                    'second',
                ],
                'options.ssl_ca': [
                    'The options.ssl ca may not contain spaces.',
                ],
            }),
        ).toEqual({
            password:
                'Re-enter the password when changing the server or connection settings.',
            'options.ssl_ca': 'The options.ssl ca may not contain spaces.',
        });
    });

    it('skips fields without messages and tolerates junk', () => {
        expect(firstErrors({ host: [] })).toEqual({});
        expect(firstErrors(undefined)).toEqual({});
        expect(firstErrors('oops')).toEqual({});
    });
});

describe('testFailureMessage', () => {
    it.each([
        [422, 'Please fix the highlighted fields first.'],
        [419, 'Your session expired — reload the page.'],
        [429, 'Too many attempts — wait a moment.'],
        [500, 'Test request failed.'],
        [null, 'Test request failed.'],
    ])('maps status %s', (status, expected) => {
        expect(testFailureMessage(status)).toBe(expected);
    });
});

describe('mysqlSslMode', () => {
    it('uses the explicit mode', () => {
        expect(mysqlSslMode({ mysql_ssl: 'required', ssl_ca: '/ca.pem' })).toBe(
            'required',
        );
        expect(mysqlSslMode({ mysql_ssl: 'disabled' })).toBe('disabled');
    });

    it('maps connections saved before the mode existed', () => {
        expect(mysqlSslMode({})).toBe('disabled');
        expect(mysqlSslMode({ ssl_ca: '' })).toBe('disabled');
        expect(mysqlSslMode({ ssl_ca: '/ca.pem' })).toBe('verify_identity');
        expect(mysqlSslMode({ ssl_ca: '/ca.pem', ssl_verify: true })).toBe(
            'verify_identity',
        );
        expect(mysqlSslMode({ ssl_ca: '/ca.pem', ssl_verify: false })).toBe(
            'required',
        );
    });
});

describe('workspaceUrl', () => {
    it('opens a fixed connection or the database list by id', () => {
        expect(workspaceUrl(5, null)).toBe('/c/5');
    });

    it('opens one database of a server-level connection', () => {
        expect(workspaceUrl(5, 'données')).toBe('/c/5/donn%C3%A9es');
        expect(workspaceUrl(5, 'a b')).toBe('/c/5/a%20b');
    });
});
