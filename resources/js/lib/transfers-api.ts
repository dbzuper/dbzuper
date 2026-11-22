import type { WorkspaceRef } from '@/types/connection';
import { apiBase, apiFetch } from '@/lib/http';

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
};

export type ToolCheck = {
    usable: boolean;
    tool: string | null;
    path: string | null;
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

export type StartExportBody = {
    tables: 'all' | string[];
    structure: boolean;
    data: boolean;
    drop?: boolean;
    gzip?: boolean;
    method?: TransferMethod | null;
};

export type StartImportBody = {
    file_name: string;
    size: number;
    confirm: string;
    method?: TransferMethod | null;
};

export const transfersApi = {
    capabilities: (ref: WorkspaceRef, tables?: string[]) => {
        const search = new URLSearchParams();
        tables?.forEach((t) => search.append('tables[]', t));
        const q = search.toString();
        return apiFetch<TransferCapabilities>(
            `${apiBase(ref)}/transfers/capabilities${q ? `?${q}` : ''}`,
        );
    },
    objects: (ref: WorkspaceRef) =>
        apiFetch<{ objects: DumpObject[] }>(
            `${apiBase(ref)}/transfers/objects`,
        ),
    list: (ref: WorkspaceRef) =>
        apiFetch<{ transfers: Transfer[] }>(`${apiBase(ref)}/transfers`),
    startExport: (ref: WorkspaceRef, body: StartExportBody) =>
        apiFetch<Transfer>(`${apiBase(ref)}/transfers/export`, {
            method: 'POST',
            body,
        }),
    startImport: (ref: WorkspaceRef, body: StartImportBody) =>
        apiFetch<Transfer>(`${apiBase(ref)}/transfers/import`, {
            method: 'POST',
            body,
        }),
    show: (ref: WorkspaceRef, id: string, signal?: AbortSignal) =>
        apiFetch<Transfer>(`${apiBase(ref)}/transfers/${id}`, { signal }),
    cancel: (ref: WorkspaceRef, id: string) =>
        apiFetch<Transfer>(`${apiBase(ref)}/transfers/${id}/cancel`, {
            method: 'POST',
        }),
    downloadUrl: (ref: WorkspaceRef, id: string) =>
        `${apiBase(ref)}/transfers/${id}/download`,
    uploadUrl: (ref: WorkspaceRef, id: string) =>
        `${apiBase(ref)}/transfers/${id}/upload`,
};
