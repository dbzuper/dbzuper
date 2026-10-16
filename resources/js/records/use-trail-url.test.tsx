import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchemaSnapshot, TableSchema } from '@/types/schema';
import { useBrowse } from '@/browse/browse-store';
import { useRecords } from './records-store';
import { addRelated, nodeId, openRoot } from './trail';
import { useTrailUrl } from './use-trail-url';
import { encodeTrail } from './url-state';

const api = vi.hoisted(() => ({ show: vi.fn(), related: vi.fn() }));
vi.mock('./records-api', () => ({ recordsApi: api }));

const table = (name: string): TableSchema => ({
    name,
    kind: 'table',
    row_count: {} as never,
    size_bytes: null,
    primary_key: ['id'],
    columns: [],
    indexes: [],
});
const snapshot = {
    driver: 'sqlite',
    database: 'd',
    schema: null,
    generated_at: '',
    hash: '',
    tables: [table('users'), table('notes')],
    relationships: [
        {
            id: 'r2',
            from_table: 'notes',
            from_columns: ['user_id'],
            to_table: 'users',
            to_columns: ['id'],
            inferred: false,
            confidence: 1,
            name: null,
        },
    ],
} as SchemaSnapshot;
const pks = (name: string) =>
    snapshot.tables.find((x) => x.name === name)?.primary_key ?? null;

const payload = (tableName: string, id: number) => ({
    table: tableName,
    key: { id },
    columns: [{ name: 'id', type: 'int' }],
    values: [id],
    relationships: [],
});
const b64 = (s: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(s)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');

const param = () => new URL(window.location.href).searchParams.get('r');
const pushSpy = () => vi.spyOn(window.history, 'pushState');

beforeEach(() => {
    vi.resetAllMocks();
    api.show.mockImplementation((_c: number, t: string, k: { id: number }) =>
        Promise.resolve(payload(t, k.id)),
    );
    window.history.replaceState({ page: 'inertia' }, '', '/?keep=1#h');
    useRecords.getState().reset();
    useRecords.getState().setConnection(1);
    useBrowse.setState({ byConnection: {} });
});
afterEach(() => vi.restoreAllMocks());

describe('useTrailUrl', () => {
    it('pushes ?r= when a root is opened, keeping other params, the hash and the history state', () => {
        const push = pushSpy();
        renderHook(() => useTrailUrl(snapshot));
        act(() => useRecords.getState().open('users', { id: 1 }));
        expect(push).toHaveBeenCalledTimes(1);
        const url = new URL(window.location.href);
        expect(url.searchParams.get('keep')).toBe('1');
        expect(url.hash).toBe('#h');
        expect(url.searchParams.get('r')).toBe(
            encodeTrail(useRecords.getState().trail, pks),
        );
        expect(window.history.state).toMatchObject({ page: 'inertia' });
    });

    it('pushes one entry per expansion and none for a repeated identical trail', async () => {
        const push = pushSpy();
        renderHook(() => useTrailUrl(snapshot));
        act(() => useRecords.getState().open('users', { id: 1 }));
        const from = nodeId('users', { id: 1 });
        api.related.mockResolvedValue({
            table: 'notes',
            columns: [{ name: 'id', type: 'int' }],
            primary_key: ['id'],
            rows: [{ key: { id: 5 }, values: [5] }],
            next_cursor: null,
        });
        await act(async () =>
            useRecords.getState().expand(from, {
                id: 'r2',
                direction: 'in',
                table: 'notes',
                columns: ['user_id'],
                other_columns: ['id'],
                inferred: false,
                available: true,
                count: { value: 1, capped: false },
            }),
        );
        expect(push).toHaveBeenCalledTimes(2);
        const note = nodeId('notes', { id: 5 });
        act(() => useRecords.getState().select(note));
        expect(push).toHaveBeenCalledTimes(3);
        act(() => useRecords.getState().select(note));
        expect(push).toHaveBeenCalledTimes(3);
    });

    it('restores the previous trail on popstate without refetching loaded nodes and without pushing', async () => {
        renderHook(() => useTrailUrl(snapshot));
        await act(async () => useRecords.getState().open('users', { id: 1 }));
        const first = param();
        const t1 = useRecords.getState().trail;
        const { trail: two } = addRelated(t1, t1.nodes[0].id, 'r2', 'in', [
            { table: 'notes', key: { id: 5 } },
        ]);
        await act(async () => useRecords.getState().setTrail(two));
        expect(param()).not.toBe(first);
        expect(api.show).toHaveBeenCalledTimes(2);

        const push = pushSpy();
        window.history.replaceState(
            window.history.state,
            '',
            `/?keep=1&r=${first}#h`,
        );
        await act(async () => {
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        expect(useRecords.getState().trail.nodes).toHaveLength(1);
        expect(useRecords.getState().trail.selected).toBe(t1.nodes[0].id);
        expect(api.show).toHaveBeenCalledTimes(2);
        expect(push).not.toHaveBeenCalled();
        expect(param()).toBe(first);
    });

    it('resets the trail on popstate when r is gone', async () => {
        renderHook(() => useTrailUrl(snapshot));
        await act(async () => useRecords.getState().open('users', { id: 1 }));
        window.history.replaceState(window.history.state, '', '/?keep=1#h');
        const push = pushSpy();
        await act(async () => {
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        expect(useRecords.getState().trail.nodes).toHaveLength(0);
        expect(push).not.toHaveBeenCalled();
    });

    it('restores the trail from ?r= on mount, opens the records tab and does not push', async () => {
        const r = encodeTrail(openRoot('users', { id: 3 }), pks);
        window.history.replaceState({ page: 'x' }, '', `/?r=${r}&keep=1#h`);
        const push = pushSpy();
        await act(async () => {
            renderHook(() => useTrailUrl(snapshot));
        });
        expect(useRecords.getState().trail.nodes[0].key).toEqual({ id: 3 });
        const browse = useBrowse.getState().get(1);
        expect(browse.activeId).toBe('records');
        expect(browse.tabs.find((t) => t.id === 'records')).toMatchObject({
            title: 'Records · users #3',
        });
        expect(push).not.toHaveBeenCalled();
        expect(param()).toBe(r);
        expect(window.location.hash).toBe('#h');
    });

    it('clears the trail and ?r= when the records tab is closed', async () => {
        renderHook(() => useTrailUrl(snapshot));
        await act(async () => useRecords.getState().open('users', { id: 1 }));
        act(() => useBrowse.getState().showRecords(1, 'Records · users #1'));
        expect(param()).not.toBeNull();
        act(() => useBrowse.getState().closeRecords(1));
        expect(useRecords.getState().trail.nodes).toHaveLength(0);
        expect(param()).toBeNull();
        expect(new URL(window.location.href).searchParams.get('keep')).toBe(
            '1',
        );
    });

    it('closes a lingering records tab when the URL has no trail', async () => {
        useBrowse.getState().showRecords(1, 'Records · users #9');
        await act(async () => {
            renderHook(() => useTrailUrl(snapshot));
        });
        expect(useBrowse.getState().get(1).activeId).toBe('universe');
        expect(
            useBrowse
                .getState()
                .get(1)
                .tabs.some((t) => t.kind === 'records'),
        ).toBe(false);
    });

    it('waits for the snapshot before restoring', async () => {
        const r = encodeTrail(openRoot('users', { id: 3 }), pks);
        window.history.replaceState(null, '', `/?r=${r}`);
        const { rerender } = renderHook(
            ({ s }: { s: SchemaSnapshot | null }) => useTrailUrl(s),
            { initialProps: { s: null as SchemaSnapshot | null } },
        );
        expect(useRecords.getState().trail.nodes).toHaveLength(0);
        await act(async () => rerender({ s: snapshot }));
        expect(useRecords.getState().trail.nodes).toHaveLength(1);
    });

    it('drops unknown tables with a singular notice and rewrites r', async () => {
        const raw = b64(
            JSON.stringify({
                v: 1,
                n: [
                    ['users', [1]],
                    ['ghost', [2]],
                ],
                e: [],
                s: 0,
            }),
        );
        window.history.replaceState(null, '', `/?r=${raw}`);
        await act(async () => {
            renderHook(() => useTrailUrl(snapshot));
        });
        expect(useRecords.getState().trail.nodes).toHaveLength(1);
        expect(useRecords.getState().notice).toBe(
            '1 record from the link is no longer in the schema and was skipped.',
        );
        expect(param()).toBe(encodeTrail(useRecords.getState().trail, pks));
    });

    it('uses the plural notice for several dropped records', async () => {
        const raw = b64(
            JSON.stringify({
                v: 1,
                n: [
                    ['users', [1]],
                    ['ghost', [2]],
                    ['ghost', [3]],
                ],
                e: [],
                s: 0,
            }),
        );
        window.history.replaceState(null, '', `/?r=${raw}`);
        await act(async () => {
            renderHook(() => useTrailUrl(snapshot));
        });
        expect(useRecords.getState().notice).toBe(
            '2 records from the link are no longer in the schema and were skipped.',
        );
    });

    it('ignores and removes a malformed r without crashing', async () => {
        window.history.replaceState(
            { page: 'x' },
            '',
            '/?r=%25%25not-base64&keep=1#h',
        );
        const push = pushSpy();
        await act(async () => {
            renderHook(() => useTrailUrl(snapshot));
        });
        expect(useRecords.getState().trail.nodes).toHaveLength(0);
        expect(param()).toBeNull();
        expect(window.location.search).toBe('?keep=1');
        expect(window.location.hash).toBe('#h');
        expect(window.history.state).toMatchObject({ page: 'x' });
        expect(push).not.toHaveBeenCalled();
    });

    it('ignores and removes an r larger than 16 KB', async () => {
        window.history.replaceState(null, '', `/?r=${'A'.repeat(17 * 1024)}`);
        await act(async () => {
            renderHook(() => useTrailUrl(snapshot));
        });
        expect(useRecords.getState().trail.nodes).toHaveLength(0);
        expect(param()).toBeNull();
    });

    it('removes an r whose nodes are all gone from the schema and tells the user', async () => {
        const raw = b64(
            JSON.stringify({ v: 1, n: [['ghost', [2]]], e: [], s: 0 }),
        );
        window.history.replaceState(null, '', `/?r=${raw}`);
        await act(async () => {
            renderHook(() => useTrailUrl(snapshot));
        });
        expect(param()).toBeNull();
        expect(useRecords.getState().trail.nodes).toHaveLength(0);
        expect(useRecords.getState().notice).toBe(
            '1 record from the link is no longer in the schema and was skipped.',
        );
    });

    it('does not push when the encoded trail is over 7,000 characters, and keeps the in-memory trail', () => {
        const push = pushSpy();
        renderHook(() => useTrailUrl(snapshot));
        const long = 'x'.repeat(5400);
        const encoded = encodeTrail(
            openRoot('users', { id: long as never }),
            pks,
        );
        expect(encoded.length).toBeGreaterThan(7000);
        expect(encoded.length).toBeLessThan(8000);
        act(() => useRecords.getState().open('users', { id: long as never }));
        expect(push).not.toHaveBeenCalled();
        expect(useRecords.getState().trail.nodes).toHaveLength(1);
        expect(useRecords.getState().notice).toBe(
            'Trail is too long to keep in the URL',
        );
    });

    it('pushes a trail that encodes to 7,000 characters or fewer', () => {
        const push = pushSpy();
        renderHook(() => useTrailUrl(snapshot));
        const long = 'x'.repeat(5000);
        const encoded = encodeTrail(
            openRoot('users', { id: long as never }),
            pks,
        );
        expect(encoded.length).toBeLessThanOrEqual(7000);
        act(() => useRecords.getState().open('users', { id: long as never }));
        expect(push).toHaveBeenCalledTimes(1);
        expect(param()).toBe(encoded);
    });

    it('ignores a hostile r on popstate and removes it', async () => {
        renderHook(() => useTrailUrl(snapshot));
        await act(async () => useRecords.getState().open('users', { id: 1 }));
        window.history.replaceState(window.history.state, '', '/?r=!!!');
        await act(async () => {
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        expect(param()).toBeNull();
        expect(useRecords.getState().trail.nodes).toHaveLength(1);
    });

    it('stops Inertia from seeing a popstate of this page, but not one for another path', async () => {
        const inertia = vi.fn();
        renderHook(() => useTrailUrl(snapshot));
        await act(async () => useRecords.getState().open('users', { id: 1 }));
        window.addEventListener('popstate', inertia);
        try {
            expect(window.history.state).toMatchObject({
                page: 'inertia',
                dbsTrail: '/',
            });
            await act(async () => {
                window.dispatchEvent(
                    new PopStateEvent('popstate', {
                        state: { page: 'inertia', dbsTrail: '/' },
                    }),
                );
            });
            expect(inertia).not.toHaveBeenCalled();
            // The untagged original entry of the same page is ours too.
            await act(async () => {
                window.dispatchEvent(
                    new PopStateEvent('popstate', {
                        state: { page: 'inertia' },
                    }),
                );
            });
            expect(inertia).not.toHaveBeenCalled();

            window.history.replaceState({ page: 'x' }, '', '/other');
            await act(async () => {
                window.dispatchEvent(
                    new PopStateEvent('popstate', { state: { page: 'x' } }),
                );
            });
            expect(inertia).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener('popstate', inertia);
        }
    });

    it('rewrites instead of pushing when a failed root empties the trail', async () => {
        const { ApiError } = await import('@/lib/http');
        api.show.mockRejectedValue(
            new ApiError(422, {
                error: {
                    kind: 'unknown',
                    reason: 'no_primary_key',
                    sqlstate: null,
                    message:
                        'users has no primary key; open it in a table tab instead.',
                },
            }),
        );
        const r = encodeTrail(openRoot('users', { id: 9 }), pks);
        window.history.replaceState({ page: 'a' }, '', '/?a=1');
        window.history.pushState({ page: 'b' }, '', `/?r=${r}`);
        const length = window.history.length;
        const push = pushSpy();
        await act(async () => {
            renderHook(() => useTrailUrl(snapshot));
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(useRecords.getState().trail.nodes).toHaveLength(0);
        expect(param()).toBeNull();
        expect(push).not.toHaveBeenCalled();
        expect(window.history.length).toBe(length);
    });
});
