import { ApiError, apiFetch } from '@/lib/http';
import type {
    DbErrorPayload,
    DdlResponse,
    LayoutPositionEntry,
    LayoutResponse,
    QueryCell,
    QueryColumn,
    SampleResponse,
    SchemaResponse,
} from '@/types/schema';

export type FilterOp =
    | 'eq'
    | 'neq'
    | 'lt'
    | 'lte'
    | 'gt'
    | 'gte'
    | 'contains'
    | 'starts_with'
    | 'ends_with'
    | 'is_null'
    | 'is_not_null';
export type RowFilter = { column: string; op: FilterOp; value?: string };
export type RowsRequest = {
    filters: RowFilter[];
    sort: { column: string; direction: 'asc' | 'desc' } | null;
    page: number;
    per_page: number;
};
export type RowsResponse = {
    columns: QueryColumn[];
    rows: QueryCell[][];
    has_more: boolean;
    page: number;
    per_page: number;
    sql: string;
};

export const FILTER_OPS: {
    value: FilterOp;
    label: string;
    needsValue: boolean;
}[] = [
    { value: 'eq', label: 'equals', needsValue: true },
    { value: 'neq', label: 'not equals', needsValue: true },
    { value: 'lt', label: '<', needsValue: true },
    { value: 'lte', label: '≤', needsValue: true },
    { value: 'gt', label: '>', needsValue: true },
    { value: 'gte', label: '≥', needsValue: true },
    { value: 'contains', label: 'contains', needsValue: true },
    { value: 'starts_with', label: 'starts with', needsValue: true },
    { value: 'ends_with', label: 'ends with', needsValue: true },
    { value: 'is_null', label: 'is null', needsValue: false },
    { value: 'is_not_null', label: 'is not null', needsValue: false },
];

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
    rows: (id: number, name: string, body: RowsRequest, signal?: AbortSignal) =>
        apiFetch<RowsResponse>(table(id, name, 'rows'), {
            method: 'POST',
            body,
            signal,
        }),
    ddl: (id: number, name: string) =>
        apiFetch<DdlResponse>(table(id, name, 'ddl')),
};

/** First message of a Laravel validation response ({message, errors}), else its message. */
function validationMessage(e: unknown): string | null {
    if (!(e instanceof ApiError) || !e.body || typeof e.body !== 'object')
        return null;
    const { errors, message } = e.body as {
        errors?: Record<string, unknown>;
        message?: unknown;
    };
    if (errors && typeof errors === 'object') {
        for (const messages of Object.values(errors)) {
            const first = Array.isArray(messages) ? messages[0] : messages;
            if (typeof first === 'string' && first) return first;
        }
    }
    return typeof message === 'string' && message ? message : null;
}

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
    const message = validationMessage(e);
    return {
        kind: message ? 'validation' : 'unknown',
        message: message ?? fallback,
        sqlstate: null,
        reason: null,
    };
}
