import type { WorkspaceRef } from '@/types/connection';
import { apiBase, apiFetch, xsrfToken } from '@/lib/http';

export type TransferStatus =
    | 'uploading'
    | 'pending'
    | 'running'
    | 'done'
    | 'failed'
    | 'cancelled';
export type TransferMethod = 'native' | 'builtin';
export type TransferDirection = 'export' | 'import';

export const ACTIVE_STATUSES: readonly TransferStatus[] = [
    'uploading',
    'pending',
    'running',
];

export type Transfer = {
    id: string;
    database: string;
    direction: TransferDirection;
    method: TransferMethod;
    status: TransferStatus;
    bytes_done: number;
    bytes_total: number | null;
    rows_done: number | null;
    rows_total: number | null;
    statements_done: number | null;
    current_table: string | null;
    file_name: string | null;
    file_size: number | null;
    warnings: string[];
    error: string | null;
    downloadable: boolean;
    cancel_requested_at: string | null;
    started_at: string | null;
    finished_at: string | null;
    expires_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    /** Whether a transfers worker has beaten recently (read with each poll). */
    worker_alive: boolean;
};

export type ToolCheck = {
    usable: boolean;
    tool: string | null;
    version: string | null;
    reason: string;
};

export type TransferCapabilities = {
    read_only: boolean;
    database_name: string;
    worker_alive: boolean;
    export: {
        native: ToolCheck;
        default_method: TransferMethod;
        builtin_gaps: string[];
        native_gaps: string[];
        /** The chosen mix of table modes can only be written by the built-in method. */
        mix_needs_builtin: boolean;
    };
    import: {
        native: ToolCheck;
        default_method: TransferMethod;
        all_or_nothing: boolean;
    };
};

export type DumpObject = {
    schema: string | null;
    name: string;
    kind: string;
    key: string;
    rows: number | null;
};

/** What a backup includes for one table. */
export type TableMode = 'both' | 'structure' | 'data';

export type StartExportBody = {
    tables: 'all' | string[];
    /** A mode for every ticked table (never views, never with 'all'); the globals below apply to the rest. */
    table_modes?: Record<string, TableMode>;
    structure: boolean;
    data: boolean;
    drop?: boolean;
    gzip?: boolean;
    method?: TransferMethod | null;
    /** The browser's IANA timezone: the time in the backup's file name is in it. Filled in by startExport. */
    timezone?: string;
};

/** This browser's IANA timezone, or undefined when it can't tell. */
export function browserTimeZone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
        return undefined;
    }
}

export type StartImportBody = {
    file_name: string;
    size: number;
    confirm: string;
    method?: TransferMethod | null;
};

export const transfersApi = {
    /** Without tables, a GET; with them, a POST: a long list doesn't fit a query string (414, max_input_vars). */
    capabilities: (
        ref: WorkspaceRef,
        tables?: 'all' | string[],
        tableModes?: Record<string, TableMode>,
    ) =>
        apiFetch<TransferCapabilities>(
            `${apiBase(ref)}/transfers/capabilities`,
            tables === undefined
                ? {}
                : {
                      method: 'POST',
                      body:
                          tableModes === undefined
                              ? { tables }
                              : { tables, table_modes: tableModes },
                  },
        ),
    objects: (ref: WorkspaceRef) =>
        apiFetch<{ objects: DumpObject[] }>(
            `${apiBase(ref)}/transfers/objects`,
        ),
    list: (ref: WorkspaceRef) =>
        apiFetch<{ transfers: Transfer[] }>(`${apiBase(ref)}/transfers`),
    startExport: (ref: WorkspaceRef, body: StartExportBody) =>
        apiFetch<Transfer>(`${apiBase(ref)}/transfers/export`, {
            method: 'POST',
            body: { timezone: browserTimeZone(), ...body },
        }),
    startImport: (ref: WorkspaceRef, body: StartImportBody) =>
        apiFetch<Transfer>(`${apiBase(ref)}/transfers/import`, {
            method: 'POST',
            body,
        }),
    show: (ref: WorkspaceRef, id: string, signal?: AbortSignal) =>
        apiFetch<Transfer>(`${apiBase(ref)}/transfers/${id}`, { signal }),
    cancel: (ref: WorkspaceRef, id: string) =>
        apiFetch<Transfer>(transfersApi.cancelUrl(ref, id), {
            method: 'POST',
        }),
    cancelUrl: (ref: WorkspaceRef, id: string) =>
        `${apiBase(ref)}/transfers/${id}/cancel`,
    /**
     * Cancels from a page that is going away (pagehide): a keepalive request outlives the page, where a normal fetch
     * would be dropped.
     */
    cancelOnLeave: (ref: WorkspaceRef, id: string) => {
        const headers: Record<string, string> = {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        };
        const token = xsrfToken();
        if (token) headers['X-XSRF-TOKEN'] = token;
        return fetch(transfersApi.cancelUrl(ref, id), {
            method: 'POST',
            keepalive: true,
            credentials: 'same-origin',
            headers,
        }).catch(() => undefined);
    },
    downloadUrl: (ref: WorkspaceRef, id: string) =>
        `${apiBase(ref)}/transfers/${id}/download`,
    uploadUrl: (ref: WorkspaceRef, id: string) =>
        `${apiBase(ref)}/transfers/${id}/upload`,
};
