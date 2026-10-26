import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithConfirmations } from './run-query';

afterEach(() => vi.restoreAllMocks());

const reply = (status: number, body: unknown) =>
    Promise.resolve(
        new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        }),
    );

describe('runWithConfirmations', () => {
    it('re-sends with confirmations until the server accepts', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementationOnce(() =>
                reply(409, {
                    confirmation: {
                        statement_index: 1,
                        mode: 'typed',
                        kind: 'destructive',
                        keyword: 'DELETE',
                        target: 'audit_log',
                    },
                }),
            )
            .mockImplementationOnce(() =>
                reply(200, {
                    results: [
                        { sql: 'select 1' },
                        { sql: 'delete from audit_log' },
                    ],
                }),
            );
        const confirm = vi
            .fn()
            .mockResolvedValue({ confirmed: true, typed: 'audit_log' });

        const out = await runWithConfirmations({
            connectionId: '1',
            statements: ['select 1', 'delete from audit_log'],
            maxRows: 1000,
            signal: new AbortController().signal,
            confirm,
        });

        expect(out).toEqual({
            results: [{ sql: 'select 1' }, { sql: 'delete from audit_log' }],
        });
        expect(confirm).toHaveBeenCalledWith(
            expect.objectContaining({ target: 'audit_log' }),
            'delete from audit_log',
        );
        expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
            statements: [
                { sql: 'select 1' },
                {
                    sql: 'delete from audit_log',
                    confirmed: true,
                    typed: 'audit_log',
                },
            ],
            max_rows: 1000,
        });
    });

    it('returns cancelled when the user declines', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
            reply(409, {
                confirmation: {
                    statement_index: 0,
                    mode: 'confirm',
                    kind: 'write',
                    keyword: 'UPDATE',
                    target: null,
                },
            }),
        );
        const out = await runWithConfirmations({
            connectionId: '1',
            statements: ['update t set a = 1 where b'],
            maxRows: 10,
            signal: new AbortController().signal,
            confirm: async () => null,
        });
        expect(out).toEqual({ cancelled: true });
    });

    it('surfaces read-only and other API errors', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
            reply(422, {
                error: {
                    kind: 'readonly',
                    message: 'This connection is read-only.',
                    sqlstate: null,
                    reason: 'readonly_connection',
                },
            }),
        );
        const out = await runWithConfirmations({
            connectionId: '1',
            statements: ['update t set a=1'],
            maxRows: 10,
            signal: new AbortController().signal,
            confirm: async () => null,
        });
        expect(out).toMatchObject({ error: { kind: 'readonly' } });
    });

    it('surfaces the first validation message', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
            reply(422, {
                message: 'x',
                errors: {
                    'statements.0.sql': [
                        'Each item must contain exactly one SQL statement.',
                    ],
                },
            }),
        );
        const out = await runWithConfirmations({
            connectionId: '1',
            statements: ['select 1'],
            maxRows: 10,
            signal: new AbortController().signal,
            confirm: async () => null,
        });
        expect(out).toMatchObject({
            error: {
                message: 'Each item must contain exactly one SQL statement.',
            },
        });
    });

    it('returns cancelled when the request is aborted', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(
            new DOMException('aborted', 'AbortError'),
        );
        const out = await runWithConfirmations({
            connectionId: '1',
            statements: ['select 1'],
            maxRows: 10,
            signal: new AbortController().signal,
            confirm: async () => null,
        });
        expect(out).toEqual({ cancelled: true });
    });
});
