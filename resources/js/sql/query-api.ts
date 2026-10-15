import { apiFetch } from '@/lib/http';
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
        id: number,
        statements: StatementInput[],
        maxRows: number,
        signal?: AbortSignal,
    ) =>
        apiFetch<RunResponse>(`/api/c/${id}/query`, {
            method: 'POST',
            body: { statements, max_rows: maxRows },
            signal,
        }),
    explain: (id: number, sql: string, signal?: AbortSignal) =>
        apiFetch<RunResponse>(`/api/c/${id}/query/explain`, {
            method: 'POST',
            body: { sql },
            signal,
        }),
};
