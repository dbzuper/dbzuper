import { ApiError, apiFetch } from '@/lib/http';
import type {
    DbErrorPayload,
    DdlResponse,
    LayoutPositionEntry,
    LayoutResponse,
    SampleResponse,
    SchemaResponse,
} from '@/types/schema';

const table = (id: number, name: string, what: string) =>
    `/api/c/${id}/tables/${encodeURIComponent(name)}/${what}`;

export const workspaceApi = {
    schema: (id: number) => apiFetch<SchemaResponse>(`/api/c/${id}/schema`),
    refresh: (id: number) =>
        apiFetch<SchemaResponse>(`/api/c/${id}/schema/refresh`, {
            method: 'POST',
        }),
    layout: (id: number) => apiFetch<LayoutResponse>(`/api/c/${id}/layout`),
    /** `keepalive` lets the save outlive the page (pagehide, navigation) when the body is small enough. */
    saveLayout: (
        id: number,
        positions: LayoutPositionEntry[],
        opts: { keepalive?: boolean } = {},
    ) =>
        apiFetch<{ saved: boolean }>(`/api/c/${id}/layout`, {
            method: 'PUT',
            body: { positions },
            keepalive: opts.keepalive,
        }),
    sample: (id: number, name: string) =>
        apiFetch<SampleResponse>(table(id, name, 'sample')),
    ddl: (id: number, name: string) =>
        apiFetch<DdlResponse>(table(id, name, 'ddl')),
};

export function dbErrorFrom(e: unknown, fallback: string): DbErrorPayload {
    const body =
        e instanceof ApiError
            ? (e.body as { error?: Partial<DbErrorPayload> } | null)
            : null;
    const error = body && typeof body === 'object' ? body.error : undefined;
    if (error && typeof error.message === 'string') {
        return {
            kind: error.kind ?? 'unknown',
            message: error.message,
            sqlstate: error.sqlstate ?? null,
            reason: error.reason ?? null,
        };
    }
    return { kind: 'unknown', message: fallback, sqlstate: null, reason: null };
}
