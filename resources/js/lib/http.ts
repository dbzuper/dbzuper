import type { WorkspaceRef } from '@/types/connection';

/** API root of a workspace. The database part of a ref is encoded; the id and its colon stay as they are. */
export function apiBase(ref: WorkspaceRef): string {
    const colon = ref.indexOf(':');
    return colon === -1
        ? `/api/c/${ref}`
        : `/api/c/${ref.slice(0, colon)}:${encodeURIComponent(ref.slice(colon + 1))}`;
}

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        /** The Retry-After header in seconds (429, 503), when the server sent one. */
        public readonly retryAfter: number | null = null,
    ) {
        super(`Request failed with status ${status}`);
    }
}

/** Retry-After as whole seconds; an HTTP date counts from now. Null when absent or unreadable. */
export function retryAfterSeconds(value: string | null): number | null {
    if (value === null || value.trim() === '') return null;
    if (/^\d+$/.test(value.trim())) return Number(value.trim());
    const at = Date.parse(value);
    return Number.isNaN(at)
        ? null
        : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

export function xsrfToken(): string | null {
    const match = document.cookie
        .split('; ')
        .find((c) => c.startsWith('XSRF-TOKEN='));
    return match ? decodeURIComponent(match.slice('XSRF-TOKEN='.length)) : null;
}

/** Browsers refuse keepalive requests whose bodies exceed 64 KiB in total, so larger ones go without it. */
export const KEEPALIVE_MAX_BYTES = 60 * 1024;

export async function apiFetch<T = unknown>(
    url: string,
    init: {
        method?: string;
        body?: unknown;
        keepalive?: boolean;
        signal?: AbortSignal;
    } = {},
): Promise<T> {
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    };
    const token = xsrfToken();
    if (token) headers['X-XSRF-TOKEN'] = token;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const body =
        init.body === undefined ? undefined : JSON.stringify(init.body);
    const keepalive =
        init.keepalive === true &&
        (body === undefined ||
            new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES);

    const response = await fetch(url, {
        method: init.method ?? 'GET',
        headers,
        credentials: 'same-origin',
        signal: init.signal,
        body,
        ...(keepalive ? { keepalive: true } : {}),
    });

    const isJson = response.headers
        .get('Content-Type')
        ?.includes('application/json');
    const payload = isJson ? await response.json() : await response.text();
    if (!response.ok)
        throw new ApiError(
            response.status,
            payload,
            retryAfterSeconds(response.headers.get('Retry-After')),
        );
    return payload as T;
}
