import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { dbErrorFrom, workspaceApi } from './workspace-api';

afterEach(() => vi.restoreAllMocks());

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));

describe('workspaceApi', () => {
    it('encodes table names in sample and ddl URLs', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ ddl: null }));
        await workspaceApi.ddl(7, 'my table/é');
        expect(fetchMock.mock.calls[0][0]).toBe('/api/c/7/tables/my%20table%2F%C3%A9/ddl');
    });

    it('sends layout with PUT', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ saved: true }));
        await workspaceApi.saveLayout(3, [{ table: 'a', x: 1, y: 2, pinned: true }]);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/c/3/layout');
        expect(init?.method).toBe('PUT');
        expect(JSON.parse(String(init?.body))).toEqual({ positions: [{ table: 'a', x: 1, y: 2, pinned: true }] });
    });
});

describe('dbErrorFrom', () => {
    it('extracts the API error payload', () => {
        const e = new ApiError(422, { error: { kind: 'auth', message: 'Denied', sqlstate: null, reason: 'auth' } });
        expect(dbErrorFrom(e, 'x')).toEqual({ kind: 'auth', message: 'Denied', sqlstate: null, reason: 'auth' });
    });

    it('falls back for unexpected shapes', () => {
        expect(dbErrorFrom(new ApiError(500, 'boom'), 'Could not load.').message).toBe('Could not load.');
        expect(dbErrorFrom(new ApiError(422, { error: { message: 5 } }), 'Fallback').message).toBe('Fallback');
        expect(dbErrorFrom(new Error('x'), 'Fallback').kind).toBe('unknown');
    });
});
