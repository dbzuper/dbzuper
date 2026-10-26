import type { WorkspaceRef } from '@/types/connection';
import { apiFetch, apiBase } from '@/lib/http';
import type { RecordKeyValues, RecordPayload, RelatedPayload } from './types';

const base = (id: WorkspaceRef, table: string) =>
    `${apiBase(id)}/records/${encodeURIComponent(table)}`;

export const recordsApi = {
    show: (
        id: WorkspaceRef,
        table: string,
        key: RecordKeyValues,
        signal?: AbortSignal,
    ) =>
        apiFetch<RecordPayload>(
            `${base(id, table)}?key=${encodeURIComponent(JSON.stringify(key))}`,
            { signal },
        ),
    related: (
        id: WorkspaceRef,
        table: string,
        key: RecordKeyValues,
        p: {
            rel: string;
            dir: 'out' | 'in';
            limit?: number;
            cursor?: string | null;
        },
        signal?: AbortSignal,
    ) => {
        const qs = new URLSearchParams({
            key: JSON.stringify(key),
            rel: p.rel,
            dir: p.dir,
            limit: String(p.limit ?? 25),
        });
        if (p.cursor) qs.set('cursor', p.cursor);
        return apiFetch<RelatedPayload>(`${base(id, table)}/related?${qs}`, {
            signal,
        });
    },
};
