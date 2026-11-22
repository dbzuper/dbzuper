import { xsrfToken } from '@/lib/http';

export const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

type Options = {
    chunkBytes?: number;
    onProgress: (sent: number) => void;
    signal?: AbortSignal;
};

type Body = { message?: string; status?: string; offset?: number };

function abortError(): DOMException {
    return new DOMException('The upload was cancelled.', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function send(
    url: string,
    chunk: Blob,
    offset: number,
    signal?: AbortSignal,
): Promise<Response> {
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/octet-stream',
        'Upload-Offset': String(offset),
    };
    const token = xsrfToken();
    if (token) headers['X-XSRF-TOKEN'] = token;
    return fetch(url, {
        method: 'PUT',
        headers,
        body: chunk,
        credentials: 'same-origin',
        signal,
    });
}

async function readBody(response: Response): Promise<Body> {
    try {
        return (await response.json()) as Body;
    } catch {
        return {};
    }
}

/**
 * An upload the server refused. `transferStatus` is the transfer's status when the server sent it (a 409), e.g.
 * `cancelled` or `failed` when the transfer ended while the file was still being sent.
 */
export class UploadError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly transferStatus: string | null = null,
    ) {
        super(message);
        this.name = 'UploadError';
    }
}

const GENERIC_SERVER_ERROR = 'Server Error';

/** A failure the server explained (a 5xx with a message): not retried. */
class ServerError extends Error {}

/**
 * Sends one chunk, retrying a network error or a 5xx up to three times (1 s, 2 s, 4 s). A 5xx whose body carries a
 * message (e.g. "Couldn't queue the job: …") is a decided failure, not a hiccup: it is surfaced at once.
 */
async function sendWithRetry(
    url: string,
    chunk: Blob,
    offset: number,
    signal?: AbortSignal,
): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
        let failure: unknown;
        try {
            const response = await send(url, chunk, offset, signal);
            if (response.status < 500) return response;
            const { message } = await readBody(response);
            // Laravel's generic "Server Error" explains nothing: that one is retried like any other 5xx.
            if (message && message !== GENERIC_SERVER_ERROR)
                throw new ServerError(message);
            failure = new Error(
                `The upload failed with status ${response.status}.`,
            );
        } catch (e) {
            if (e instanceof ServerError) throw e;
            if (signal?.aborted) throw abortError();
            failure = e;
        }
        if (attempt >= RETRY_DELAYS_MS.length) throw failure;
        await sleep(RETRY_DELAYS_MS[attempt], signal);
    }
}

/** Sends the file in sequential chunks, resuming from the server's offset after a conflict. */
export async function uploadInChunks(
    file: File,
    url: string,
    opts: Options,
): Promise<void> {
    const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    const { signal } = opts;
    let offset = 0;

    while (offset < file.size) {
        if (signal?.aborted) throw abortError();
        const chunk = file.slice(offset, offset + chunkBytes);
        const response = await sendWithRetry(url, chunk, offset, signal);
        const body = await readBody(response);

        if (response.ok) {
            offset =
                typeof body.offset === 'number'
                    ? body.offset
                    : offset + chunk.size;
            opts.onProgress(Math.min(offset, file.size));
            continue;
        }
        if (response.status === 409) {
            if (
                body.status === 'uploading' &&
                typeof body.offset === 'number'
            ) {
                offset = body.offset;
                opts.onProgress(Math.min(offset, file.size));
                continue;
            }
            if (['pending', 'running', 'done'].includes(body.status ?? '')) {
                opts.onProgress(file.size);
                return;
            }
        }
        throw new UploadError(
            body.message ?? `The upload failed with status ${response.status}.`,
            response.status,
            typeof body.status === 'string' ? body.status : null,
        );
    }
}
