import { apiFetch } from '@/lib/http';

export type Pin = { id: number; table: string; position: number };

const base = (id: number) => `/api/c/${id}/pins`;

export const pinsApi = {
    list: (id: number) => apiFetch<{ pins: Pin[] }>(base(id)),
    add: (id: number, table: string) =>
        apiFetch<{ pin: Pin }>(base(id), { method: 'POST', body: { table } }),
    remove: (id: number, pinId: number) =>
        apiFetch<null>(`${base(id)}/${pinId}`, { method: 'DELETE' }),
    reorder: (id: number, ids: number[]) =>
        apiFetch<{ pins: Pin[] }>(`${base(id)}/order`, {
            method: 'PUT',
            body: { ids },
        }),
};
