import type { WorkspaceRef } from '@/types/connection';
import { apiFetch, apiBase } from '@/lib/http';
import type { StatementResultPayload } from '@/types/schema';

export type StatementInput = {
    sql: string;
    confirmed?: boolean;
    typed?: string;
};

export type RunResponse = {
    results: StatementResultPayload[];
    /** The batch ended inside a transaction, which the server rolled back. */
    open_transaction_rolled_back?: boolean;
};

export const queryApi = {
    run: (
        id: WorkspaceRef,
        statements: StatementInput[],
        maxRows: number,
        signal?: AbortSignal,
    ) =>
        apiFetch<RunResponse>(`${apiBase(id)}/query`, {
            method: 'POST',
            body: { statements, max_rows: maxRows },
            signal,
        }),
    explain: (id: WorkspaceRef, sql: string, signal?: AbortSignal) =>
        apiFetch<RunResponse>(`${apiBase(id)}/query/explain`, {
            method: 'POST',
            body: { sql },
            signal,
        }),
};
