import type { WorkspaceRef } from '@/types/connection';
import { apiFetch, apiBase } from '@/lib/http';

export type HistoryEntry = {
    id: number;
    sql: string;
    kind: string;
    status: 'ok' | 'error';
    duration_ms: number;
    row_count: number | null;
    affected: number | null;
    error: string | null;
    created_at: string;
    connection?: { id: number; name: string };
    /** On the global list: the database of a server-level connection the entry ran on, else null. */
    database?: string | null;
};

export type HistoryPage = {
    entries: HistoryEntry[];
    next_before_id: number | null;
};

export type HistoryParams = {
    q?: string;
    status?: 'ok' | 'error';
    before_id?: number;
    connection_id?: number;
};

function query(params: HistoryParams): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const s = search.toString();
    return s ? `?${s}` : '';
}

export const historyApi = {
    /** Per-connection endpoint when an id is given, otherwise the global one (`connection_id` filters it). */
    list: (
        connectionId: WorkspaceRef | null,
        params: HistoryParams,
        signal?: AbortSignal,
    ) =>
        apiFetch<HistoryPage>(
            connectionId === null
                ? `/api/history${query(params)}`
                : `${apiBase(connectionId)}/history${query({ ...params, connection_id: undefined })}`,
            { signal },
        ),
    show: (connectionId: WorkspaceRef, entryId: number) =>
        apiFetch<HistoryEntry>(`${apiBase(connectionId)}/history/${entryId}`),
    clear: (connectionId: WorkspaceRef) =>
        apiFetch<{ cleared: number }>(`${apiBase(connectionId)}/history`, {
            method: 'DELETE',
        }),
};
