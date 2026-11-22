import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadInChunks } from './chunked-upload';

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const file = (size: number) => new File([new Uint8Array(size)], 'dump.sql');

const offsetOf = (call: unknown[]) =>
    (call[1] as { headers: Record<string, string> }).headers['Upload-Offset'];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('uploadInChunks', () => {
    it('sends every chunk at its offset and reports progress', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (_url, init) => {
                const at = Number(
                    (init!.headers as Record<string, string>)['Upload-Offset'],
                );
                const size = (init!.body as Blob).size;
                return json(200, { offset: at + size });
            });
        const progress: number[] = [];

        await uploadInChunks(file(25), '/up', {
            chunkBytes: 10,
            onProgress: (n) => progress.push(n),
        });

        expect(fetchMock.mock.calls.map(offsetOf)).toEqual(['0', '10', '20']);
        const init = fetchMock.mock.calls[0][1] as RequestInit & {
            headers: Record<string, string>;
        };
        expect(init.method).toBe('PUT');
        expect(init.headers['Content-Type']).toBe('application/octet-stream');
        expect(progress).toEqual([10, 20, 25]);
    });

    it('jumps to the server offset after a 409', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(json(200, { offset: 10 }))
            .mockResolvedValueOnce(
                json(409, {
                    message: 'at 20',
                    status: 'uploading',
                    offset: 20,
                }),
            )
            .mockResolvedValueOnce(json(200, { offset: 25 }));

        await uploadInChunks(file(25), '/up', {
            chunkBytes: 10,
            onProgress: () => {},
        });

        expect(fetchMock.mock.calls.map(offsetOf)).toEqual(['0', '10', '20']);
    });

    it('treats a 409 for a finished transfer as complete', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            json(409, { message: 'x', status: 'pending' }),
        );
        await expect(
            uploadInChunks(file(25), '/up', {
                chunkBytes: 10,
                onProgress: () => {},
            }),
        ).resolves.toBeUndefined();
    });

    it('rejects with the message for a cancelled transfer or a 422', async () => {
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(
                json(409, { message: 'It was cancelled', status: 'cancelled' }),
            )
            .mockResolvedValueOnce(json(422, { message: 'Bad offset' }));
        const run = () =>
            uploadInChunks(file(25), '/up', {
                chunkBytes: 10,
                onProgress: () => {},
            });
        await expect(run()).rejects.toThrow('It was cancelled');
        await expect(run()).rejects.toThrow('Bad offset');
    });

    it('retries a network error on the same chunk with backoff', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValueOnce(new TypeError('network'))
            .mockResolvedValueOnce(json(503, { message: 'busy' }))
            .mockResolvedValueOnce(json(200, { offset: 10 }));

        const done = uploadInChunks(file(10), '/up', {
            chunkBytes: 10,
            onProgress: () => {},
        });
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000);
        await done;

        expect(fetchMock.mock.calls.map(offsetOf)).toEqual(['0', '0', '0']);
    });

    it('gives up after three retries', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockRejectedValue(new TypeError('network'));

        const done = uploadInChunks(file(10), '/up', {
            chunkBytes: 10,
            onProgress: () => {},
        });
        const assertion = expect(done).rejects.toThrow('network');
        await vi.advanceTimersByTimeAsync(7000);
        await assertion;

        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('stops at once when aborted', async () => {
        const controller = new AbortController();
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        controller.abort();

        await expect(
            uploadInChunks(file(10), '/up', {
                chunkBytes: 10,
                onProgress: () => {},
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
