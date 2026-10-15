export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
    ) {
        super(`Request failed with status ${status}`);
    }
}

function xsrfToken(): string | null {
    const match = document.cookie
        .split('; ')
        .find((c) => c.startsWith('XSRF-TOKEN='));
    return match ? decodeURIComponent(match.slice('XSRF-TOKEN='.length)) : null;
}

/** Browsers refuse keepalive requests whose bodies exceed 64 KiB in total, so larger ones go without it. */
export const KEEPALIVE_MAX_BYTES = 60 * 1024;

export async function apiFetch<T = unknown>(
    url: string,
    init: { method?: string; body?: unknown; keepalive?: boolean } = {},
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
        body,
        ...(keepalive ? { keepalive: true } : {}),
    });

    const isJson = response.headers
        .get('Content-Type')
        ?.includes('application/json');
    const payload = isJson ? await response.json() : await response.text();
    if (!response.ok) throw new ApiError(response.status, payload);
    return payload as T;
}
