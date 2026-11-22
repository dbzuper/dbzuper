import { afterEach, describe, expect, it, vi } from 'vitest';
import { transfersApi } from './transfers-api';

const ok = () =>
    new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });

afterEach(() => vi.restoreAllMocks());

describe('transfersApi.capabilities', () => {
    it('GETs without tables', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
        await transfersApi.capabilities('5');
        expect(fetchMock.mock.calls[0][0]).toBe(
            '/api/c/5/transfers/capabilities',
        );
        expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
    });

    it('POSTs a chosen set as JSON, however long', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
        const keys = Array.from({ length: 2000 }, (_, i) => `t${i}`);
        await transfersApi.capabilities('5', keys);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/c/5/transfers/capabilities');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init?.body as string)).toEqual({ tables: keys });
    });
});

describe('transfersApi.cancelOnLeave', () => {
    afterEach(() => {
        document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    });

    it('POSTs the cancel with keepalive and the XSRF token', async () => {
        document.cookie = 'XSRF-TOKEN=tok%3D';
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
        await transfersApi.cancelOnLeave('5', 't1');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/c/5/transfers/t1/cancel');
        expect(init).toMatchObject({
            method: 'POST',
            keepalive: true,
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'X-XSRF-TOKEN': 'tok=',
            },
        });
    });

    it('swallows a failure: the page is going away', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('gone'));
        await expect(
            transfersApi.cancelOnLeave('5', 't1'),
        ).resolves.toBeUndefined();
    });
});
