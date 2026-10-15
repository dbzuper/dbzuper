import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, KEEPALIVE_MAX_BYTES } from './http';

afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('apiFetch', () => {
    it('sends JSON with the decoded XSRF token and parses the response', async () => {
        document.cookie = 'XSRF-TOKEN=abc%3D%3D';
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        const result = await apiFetch<{ ok: boolean }>('/api/x', {
            method: 'POST',
            body: { a: 1 },
        });

        expect(result).toEqual({ ok: true });
        const [, init] = fetchMock.mock.calls[0];
        const headers = init?.headers as Record<string, string>;
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe('{"a":1}');
        expect(headers['X-XSRF-TOKEN']).toBe('abc==');
        expect(headers['Accept']).toBe('application/json');
    });

    it('throws ApiError carrying status and parsed body on non-2xx', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
            Promise.resolve(
                new Response(JSON.stringify({ error: { kind: 'auth' } }), {
                    status: 422,
                    headers: { 'Content-Type': 'application/json' },
                }),
            ),
        );

        await expect(apiFetch('/api/x')).rejects.toMatchObject({
            status: 422,
            body: { error: { kind: 'auth' } },
        });
        await expect(apiFetch('/api/x')).rejects.toBeInstanceOf(ApiError);
    });

    it('sends small bodies with keepalive when asked', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(() =>
                Promise.resolve(new Response(null, { status: 204 })),
            );
        await apiFetch('/api/x', { method: 'PUT', body: { a: 1 } });
        await apiFetch('/api/x', {
            method: 'PUT',
            body: { a: 1 },
            keepalive: true,
        });
        expect(fetchMock.mock.calls[0][1]?.keepalive).toBeUndefined();
        expect(fetchMock.mock.calls[1][1]?.keepalive).toBe(true);
    });

    it('drops keepalive for bodies over the browser limit', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(() =>
                Promise.resolve(new Response(null, { status: 204 })),
            );
        await apiFetch('/api/x', {
            method: 'PUT',
            body: { a: 'x'.repeat(KEEPALIVE_MAX_BYTES) },
            keepalive: true,
        });
        expect(fetchMock.mock.calls[0][1]?.keepalive).toBeUndefined();
    });
});
