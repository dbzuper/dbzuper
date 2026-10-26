import type { WorkspaceRef } from '@/types/connection';
import { apiFetch, apiBase } from '@/lib/http';

export type Pin = { id: number; table: string; position: number };

const base = (id: WorkspaceRef) => `${apiBase(id)}/pins`;

export const pinsApi = {
    list: (id: WorkspaceRef) => apiFetch<{ pins: Pin[] }>(base(id)),
    add: (id: WorkspaceRef, table: string) =>
        apiFetch<{ pin: Pin }>(base(id), { method: 'POST', body: { table } }),
    remove: (id: WorkspaceRef, pinId: number) =>
        apiFetch<null>(`${base(id)}/${pinId}`, { method: 'DELETE' }),
    reorder: (id: WorkspaceRef, ids: number[]) =>
        apiFetch<{ pins: Pin[] }>(`${base(id)}/order`, {
            method: 'PUT',
            body: { ids },
        }),
};
