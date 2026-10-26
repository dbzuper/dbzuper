import type { WorkspaceRef } from '@/types/connection';
import { ApiError, apiFetch, apiBase } from '@/lib/http';
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
    | 'is_not_null'
    | 'on'
    | 'between'
    | 'after';
export type RowFilter = {
    column: string;
    op: FilterOp;
    value?: string;
    to?: string;
};
export type SortKey = { column: string; direction: 'asc' | 'desc' };
export const PER_PAGE_OPTIONS = [50, 100, 500, 1000] as const;
export type PerPage = (typeof PER_PAGE_OPTIONS)[number];
export type RowsRequest = {
    filters: RowFilter[];
    sort: SortKey[];
    page: number;
    per_page: number;
};
export type EditMethod =
    | 'primary_key'
    | 'unique_index'
    | 'sqlite_rowid'
    | 'pg_ctid'
    | 'mysql_all_values'
    | 'none';
/** How the server pins one loaded row for UPDATE/DELETE; every value is exact (never shortened for display). */
export type RowIdentity =
    | { key: Record<string, string | number | null> }
    | { rowid: string }
    | { ctid: string; xmin: string; filenode: string; tableoid?: string }
    | { values: Record<string, string | number | null> };
export type RowsEditing = {
    method: EditMethod;
    reason: string | null;
    read_only_columns: string[];
};
export type RowsResponse = {
    columns: QueryColumn[];
    rows: QueryCell[][];
    has_more: boolean;
    page: number;
    per_page: number;
    sql: string;
    editing: RowsEditing;
    /** Parallel to rows; null when the row can't be pinned. */
    row_ids: (RowIdentity | null)[];
    /** Parallel to rows: column indexes whose shown value isn't exact or that can't be edited. */
    locked: number[][];
    /**
     * Parallel to rows: column indexes whose shown value isn't the stored one (cut for display, or binary). A change
     * lists these columns in `shortened` instead of sending their originals.
     */
    shortened: number[][];
};
export type CountResponse = { count: number | null; kind: 'exact' | 'timeout' };

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
    { value: 'on', label: 'on', needsValue: true },
    { value: 'between', label: 'between', needsValue: true },
    { value: 'after', label: 'after', needsValue: true },
];

const table = (id: WorkspaceRef, name: string, what: string) =>
    `${apiBase(id)}/tables/${encodeURIComponent(name)}/${what}`;

export const workspaceApi = {
    schema: (id: WorkspaceRef) =>
        apiFetch<SchemaResponse>(`${apiBase(id)}/schema`),
    refresh: (id: WorkspaceRef) =>
        apiFetch<SchemaResponse>(`${apiBase(id)}/schema/refresh`, {
            method: 'POST',
        }),
    layout: (id: WorkspaceRef) =>
        apiFetch<LayoutResponse>(`${apiBase(id)}/layout`),
    /**
     * `keepalive` lets the save outlive the page (pagehide, navigation) when the body is small enough;
     * `merge` updates only the given tables instead of replacing the stored layout.
     */
    saveLayout: (
        id: WorkspaceRef,
        positions: LayoutPositionEntry[],
        opts: { keepalive?: boolean; merge?: boolean } = {},
    ) =>
        apiFetch<{ saved: boolean }>(`${apiBase(id)}/layout`, {
            method: 'PUT',
            body: opts.merge ? { merge: true, positions } : { positions },
            keepalive: opts.keepalive,
        }),
    sample: (id: WorkspaceRef, name: string) =>
        apiFetch<SampleResponse>(table(id, name, 'sample')),
    rows: (
        id: WorkspaceRef,
        name: string,
        body: RowsRequest,
        signal?: AbortSignal,
    ) =>
        apiFetch<RowsResponse>(table(id, name, 'rows'), {
            method: 'POST',
            body,
            signal,
        }),
    ddl: (id: WorkspaceRef, name: string) =>
        apiFetch<DdlResponse>(table(id, name, 'ddl')),
    count: (
        id: WorkspaceRef,
        name: string,
        body: { filters: RowFilter[]; exact: boolean },
        signal?: AbortSignal,
    ) =>
        apiFetch<CountResponse>(table(id, name, 'count'), {
            method: 'POST',
            body,
            signal,
        }),
};

/** First message of a Laravel validation response (422 {message, errors}), else its message. */
function validationMessage(e: unknown): string | null {
    if (
        !(e instanceof ApiError) ||
        e.status !== 422 ||
        !e.body ||
        typeof e.body !== 'object'
    )
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
