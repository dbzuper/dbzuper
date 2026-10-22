import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    filterSummary,
    flushBrowse,
    latestTableTab,
    tabTitle,
    type TableTab,
    type TableTabState,
    useBrowse,
} from './browse-store';
import type { RowFilter } from '@/lib/workspace-api';
import { rowsCache } from './rows-cache';

const C = 1;
const st = () => useBrowse.getState();
const tabs = () =>
    st()
        .get(C)
        .tabs.map((t) => t.id);
const active = () => st().get(C).activeId;
const tableTabs = (connectionId = C) =>
    st()
        .get(connectionId)
        .tabs.filter((t): t is TableTab => t.kind === 'table');
/** The id of the tab showing `table` (its ordinal-1 view unless asked otherwise). */
const tableTabId = (table: string, ordinal = 1, connectionId = C) =>
    tableTabs(connectionId).find(
        (t) => t.table === table && t.ordinal === ordinal,
    )?.id ?? `missing:${table}`;

beforeEach(() => {
    flushBrowse();
    useBrowse.setState({ byConnection: {} });
    flushBrowse();
    localStorage.clear();
});

describe('opening tables', () => {
    it('starts with only the Universe tab', () => {
        expect(tabs()).toEqual(['universe']);
        expect(active()).toBe('universe');
    });

    it('reuses one preview tab for single clicks', () => {
        st().openTable(C, 'users');
        st().openTable(C, 'orders');
        expect(tabs()).toEqual(['universe', tableTabId('orders')]);
        expect(active()).toBe(tableTabId('orders'));
    });

    it('keeps permanent tabs and inserts a new preview after the active tab', () => {
        st().openTable(C, 'users', { mode: 'permanent' });
        st().openTable(C, 'orders');
        st().openTable(C, 'items', { mode: 'permanent' });
        expect(tabs()).toEqual([
            'universe',
            tableTabId('users'),
            tableTabId('orders'),
            tableTabId('items'),
        ]);
    });

    it('focuses an existing tab instead of opening a second one, promoting it when asked', () => {
        st().openTable(C, 'users');
        st().openTable(C, 'users', { mode: 'permanent' });
        const tab = st().get(C).tabs[1];
        expect(tabs()).toHaveLength(2);
        expect(tab.kind === 'table' && tab.preview).toBe(false);
    });

    it('opens background tabs without activating them', () => {
        st().openTable(C, 'users', { mode: 'background' });
        expect(active()).toBe('universe');
        expect(tabs()).toContain(tableTabId('users'));
    });

    it('applies initial state (an FK filter) and replaces the state of an existing tab', () => {
        st().openTable(C, 'orders', {
            mode: 'permanent',
            state: { filters: [{ column: 'user_id', op: 'eq', value: '3' }] },
        });
        st().updateTable(C, tableTabId('orders'), { page: 4 });
        st().openTable(C, 'orders', {
            state: { filters: [{ column: 'user_id', op: 'eq', value: '9' }] },
        });
        const tab = st().get(C).tabs[1];
        expect(tab.kind === 'table' && tab.state.filters[0].value).toBe('9');
        expect(tab.kind === 'table' && tab.state.page).toBe(1);
    });

    it('merges state into an existing tab when asked, keeping its filters, sort and page', () => {
        const filters = [{ column: 'user_id', op: 'eq' as const, value: '3' }];
        st().openTable(C, 'orders', { mode: 'permanent', state: { filters } });
        st().updateTable(C, tableTabId('orders'), { page: 4 });
        // A column pick from the command palette.
        st().openTable(C, 'orders', { state: {}, merge: true });
        let tab = st().get(C).tabs[1];
        expect(tab.kind === 'table' && tab.state.filters).toEqual(filters);
        expect(tab.kind === 'table' && tab.state.page).toBe(4);
        // The Structure action.
        st().openTable(C, 'orders', {
            mode: 'permanent',
            state: { view: 'structure' },
            merge: true,
        });
        tab = st().get(C).tabs[1];
        expect(tab.kind === 'table' && tab.state.filters).toEqual(filters);
        expect(tab.kind === 'table' && tab.state.view).toBe('structure');
        expect(tab.kind === 'table' && tab.state.page).toBe(4);
    });

    it('merges state into defaults for a new tab', () => {
        st().openTable(C, 'orders', {
            state: { view: 'structure' },
            merge: true,
        });
        const tab = st().get(C).tabs[1];
        expect(tab.kind === 'table' && tab.state).toMatchObject({
            view: 'structure',
            filters: [],
            page: 1,
        });
    });

    it('uses the connection page size for new tabs and remembers changes to it', () => {
        st().openTable(C, 'users', { mode: 'permanent' });
        st().updateTable(C, tableTabId('users'), { perPage: 500 });
        st().openTable(C, 'orders', { mode: 'permanent' });
        const orders = st().get(C).tabs[2];
        expect(orders.kind === 'table' && orders.state.perPage).toBe(500);
    });

    it('tracks the 10 most recent tables, newest first, without duplicates', () => {
        for (let i = 0; i < 12; i++) st().openTable(C, `t${i}`);
        st().openTable(C, 't5');
        expect(st().get(C).recents).toEqual([
            't5',
            't11',
            't10',
            't9',
            't8',
            't7',
            't6',
            't4',
            't3',
            't2',
        ]);
    });
});

describe('promotion', () => {
    it('promotes a preview on filter, sort, page, page-size changes or opening the drawer, but not on view changes or closing the drawer', () => {
        st().openTable(C, 'users');
        const id = tableTabId('users');
        st().updateTable(C, id, { view: 'structure', drawerRow: null });
        let tab = st().get(C).tabs[1];
        expect(tab.kind === 'table' && tab.preview).toBe(true);
        st().updateTable(C, id, { page: 2 });
        tab = st().get(C).tabs[1];
        expect(tab.kind === 'table' && tab.preview).toBe(false);
    });

    it('promotes a preview when the row drawer opens', () => {
        st().openTable(C, 'users');
        st().updateTable(C, tableTabId('users'), { drawerRow: 2 });
        const tab = st().get(C).tabs[1];
        expect(tab.kind === 'table' && tab.preview).toBe(false);
    });
});

describe('closing and moving', () => {
    beforeEach(() => {
        for (const t of ['a', 'b', 'c'])
            st().openTable(C, t, { mode: 'permanent' });
    });

    it('never closes the Universe tab', () => {
        st().closeTab(C, 'universe');
        st().closeAll(C);
        expect(tabs()).toEqual(['universe']);
    });

    it('activates the right neighbour (else the left) when closing the active tab', () => {
        st().activate(C, tableTabId('b'));
        st().closeTab(C, tableTabId('b'));
        expect(active()).toBe(tableTabId('c'));
        st().closeTab(C, tableTabId('c'));
        expect(active()).toBe(tableTabId('a'));
    });

    it('closes others and to the right', () => {
        st().closeRight(C, tableTabId('a'));
        expect(tabs()).toEqual(['universe', tableTabId('a')]);
        st().openTable(C, 'z', { mode: 'permanent' });
        st().closeOthers(C, tableTabId('z'));
        expect(tabs()).toEqual(['universe', tableTabId('z')]);
    });

    it('moves tabs but keeps Universe first', () => {
        st().move(C, tableTabId('c'), 0);
        expect(tabs()).toEqual([
            'universe',
            tableTabId('c'),
            tableTabId('a'),
            tableTabId('b'),
        ]);
    });

    it('jumps and cycles', () => {
        st().activateIndex(C, 2);
        expect(active()).toBe(tableTabId('b'));
        st().activateIndex(C, 9);
        expect(active()).toBe(tableTabId('b'));
        st().cycle(C, 1);
        st().cycle(C, 1);
        expect(active()).toBe('universe');
        st().cycle(C, -1);
        expect(active()).toBe(tableTabId('c'));
    });
});

describe('records tab', () => {
    it('is a single tab that can be shown, retitled and closed', () => {
        st().showRecords(C, 'Records · users #1');
        st().showRecords(C, 'Records · orders #9');
        expect(tabs().filter((id) => id === 'records')).toHaveLength(1);
        expect(active()).toBe('records');
        st().closeRecords(C);
        expect(tabs()).not.toContain('records');
    });
});

describe('reconcile after a schema refresh', () => {
    it('drops filters and sort keys on missing columns and reports missing tables', () => {
        st().openTable(C, 'users', {
            mode: 'permanent',
            state: {
                filters: [
                    { column: 'gone', op: 'is_null' },
                    { column: 'id', op: 'eq', value: '1' },
                ],
                sort: [{ column: 'gone', direction: 'asc' }],
            },
        });
        st().openTable(C, 'dropped', { mode: 'permanent' });
        const result = st().reconcile(C, new Map([['users', ['id', 'name']]]));
        expect(result).toEqual({ dropped: ['dropped'], cleaned: ['users'] });
        const users = st().get(C).tabs[1];
        expect(users.kind === 'table' && users.state.filters).toEqual([
            { column: 'id', op: 'eq', value: '1' },
        ]);
        expect(users.kind === 'table' && users.state.sort).toEqual([]);
        // Missing tables keep their tab (it shows "no longer exists"); recents forget them.
        expect(tabs()).toContain(tableTabId('dropped'));
        expect(st().get(C).recents).not.toContain('dropped');
    });
});

describe('persistence', () => {
    it('restores tabs from storage and survives corrupt or hostile data', async () => {
        st().openTable(C, 'order items/数据', { mode: 'permanent' });
        await new Promise((r) => setTimeout(r, 300));
        useBrowse.setState({ byConnection: {} });
        await useBrowse.persist.rehydrate();
        expect(tabs()).toEqual(['universe', tableTabId('order items/数据')]);

        localStorage.setItem('dbsuperb.browse', '{not json');
        useBrowse.setState({ byConnection: {} });
        await useBrowse.persist.rehydrate();
        expect(tabs()).toEqual(['universe']);

        localStorage.setItem(
            'dbsuperb.browse',
            JSON.stringify({
                state: {
                    byConnection: {
                        1: {
                            tabs: [{ id: 'x', kind: 'table', table: 5 }],
                            activeId: 'x',
                            recents: 'no',
                            perPage: 7,
                        },
                    },
                },
                version: 1,
            }),
        );
        useBrowse.setState({ byConnection: {} });
        await useBrowse.persist.rehydrate();
        expect(st().get(C)).toMatchObject({
            tabs: [{ id: 'universe' }],
            activeId: 'universe',
            recents: [],
            perPage: 100,
        });
    });

    const KEY = 'dbsuperb.browse';
    const stored = () =>
        JSON.parse(localStorage.getItem(KEY) ?? '{}').state?.byConnection ?? {};
    const storedTables = (connectionId: number) =>
        (stored()[connectionId]?.tabs ?? [])
            .filter((t: { kind: string }) => t.kind === 'table')
            .map((t: { table: string }) => t.table);

    it('writes only the connections this window changed, keeping what another window stored', () => {
        st().openTable(1, 'mine', { mode: 'permanent' });
        st().openTable(2, 'mine too', { mode: 'permanent' });
        flushBrowse();
        // Another window saves its own tabs for connection 2.
        const other = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        other.state.byConnection[2].tabs.push({
            id: 't:theirs-1',
            kind: 'table',
            table: 'theirs',
            ordinal: 1,
            activatedAt: 1,
            preview: false,
            state: {},
        });
        localStorage.setItem(KEY, JSON.stringify(other));

        st().openTable(1, 'mine later', { mode: 'permanent' });
        flushBrowse();

        expect(storedTables(1)).toEqual(['mine', 'mine later']);
        expect(storedTables(2)).toEqual(['mine too', 'theirs']);
    });

    it('rehydrates when another window saves', async () => {
        st().openTable(1, 'mine', { mode: 'permanent' });
        flushBrowse();
        const other = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        other.state.byConnection[3] = {
            tabs: [
                { id: 'universe', kind: 'universe' },
                {
                    id: 't:theirs-1',
                    kind: 'table',
                    table: 'theirs',
                    ordinal: 1,
                    activatedAt: 1,
                    preview: false,
                    state: {},
                },
            ],
            activeId: 'universe',
            recents: [],
            perPage: 100,
        };
        localStorage.setItem(KEY, JSON.stringify(other));

        window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

        await vi.waitFor(() =>
            expect(
                st()
                    .get(3)
                    .tabs.map((t) => t.id),
            ).toEqual(['universe', 't:theirs-1']),
        );
        expect(tabs()).toEqual(['universe', tableTabId('mine')]);
    });
});

describe('views: several tabs of one table', () => {
    const tab = (id: string) =>
        st()
            .get(C)
            .tabs.find((t) => t.id === id) as TableTab;

    it('gives table tabs random ids that do not name the table', () => {
        st().openTable(C, 'orders', { mode: 'permanent' });
        const [orders] = tableTabs();
        expect(orders.id).toMatch(/^t:[A-Za-z0-9-]{1,64}$/);
        expect(orders.id).not.toBe('t:orders');
        expect(orders.ordinal).toBe(1);
    });

    it('focuses the same tab when a table is opened twice', () => {
        const first = st().openTable(C, 'orders', { mode: 'permanent' });
        st().openTable(C, 'users', { mode: 'permanent' });
        const second = st().openTable(C, 'orders');
        expect(second).toBe(first);
        expect(tableTabs()).toHaveLength(2);
        expect(active()).toBe(first);
    });

    it('duplicates a tab right after it: same state with the drawer closed, permanent, ordinal 2, active', () => {
        const orders = st().openTable(C, 'orders');
        st().openTable(C, 'users', { mode: 'permanent' });
        st().activate(C, orders);
        st().updateTable(C, orders, {
            filters: [{ column: 'status', op: 'eq', value: 'paid' }],
            sort: [{ column: 'id', direction: 'desc' }],
            page: 3,
            view: 'structure',
            drawerRow: 2,
        });
        const copy = st().duplicateTab(C, orders);
        expect(copy).not.toBe(orders);
        expect(tabs()).toEqual(['universe', orders, copy, tableTabId('users')]);
        expect(active()).toBe(copy);
        expect(tab(copy)).toMatchObject({
            table: 'orders',
            ordinal: 2,
            preview: false,
            state: {
                filters: [{ column: 'status', op: 'eq', value: 'paid' }],
                sort: [{ column: 'id', direction: 'desc' }],
                page: 3,
                view: 'structure',
                drawerRow: null,
            },
        });
        expect(tabTitle(tab(copy))).toBe('orders (2)');
        expect(tabTitle(tab(orders))).toBe('orders');
    });

    it('never makes a duplicate a preview and leaves other tabs alone', () => {
        const orders = st().openTable(C, 'orders');
        const copy = st().duplicateTab(C, orders);
        expect(tab(copy).preview).toBe(false);
        expect(tab(orders).preview).toBe(true);
        expect(st().duplicateTab(C, 'universe')).toBe('');
    });

    it('reuses the lowest free ordinal from 2', () => {
        const orders = st().openTable(C, 'orders', { mode: 'permanent' });
        const two = st().duplicateTab(C, orders);
        const three = st().duplicateTab(C, orders);
        expect(tab(three).ordinal).toBe(3);
        st().closeTab(C, two);
        const again = st().duplicateTab(C, orders);
        expect(tab(again).ordinal).toBe(2);
        expect(tabTitle(tab(again))).toBe('orders (2)');
    });

    it('opens a table on the tab of it that was active last', () => {
        const orders = st().openTable(C, 'orders', { mode: 'permanent' });
        const copy = st().duplicateTab(C, orders);
        expect(latestTableTab(C, 'orders')?.id).toBe(copy);
        st().activate(C, orders);
        expect(latestTableTab(C, 'orders')?.id).toBe(orders);
        st().activate(C, copy);
        st().openTable(C, 'users');
        expect(st().openTable(C, 'orders')).toBe(copy);
        expect(latestTableTab(C, 'nope')).toBeNull();
    });

    it('replaces the filters of the latest tab on a filtered open', () => {
        const orders = st().openTable(C, 'orders', { mode: 'permanent' });
        const copy = st().duplicateTab(C, orders);
        st().openTable(C, 'orders', {
            state: { filters: [{ column: 'id', op: 'eq', value: '7' }] },
        });
        expect(tab(copy).state.filters).toEqual([
            { column: 'id', op: 'eq', value: '7' },
        ]);
        expect(tab(orders).state.filters).toEqual([]);
    });

    it('opens a new view with default state, permanent, after the active tab', () => {
        const orders = st().openTable(C, 'orders', { mode: 'permanent' });
        st().updateTable(C, orders, {
            filters: [{ column: 'id', op: 'gt', value: '1' }],
            perPage: 500,
        });
        const users = st().openTable(C, 'users', { mode: 'permanent' });
        st().activate(C, orders);
        const view = st().openNewView(C, 'orders');
        expect(tabs()).toEqual(['universe', orders, view, users]);
        expect(active()).toBe(view);
        expect(tab(view)).toMatchObject({
            table: 'orders',
            ordinal: 2,
            preview: false,
            state: {
                filters: [],
                sort: [],
                page: 1,
                perPage: 500,
                view: 'data',
                drawerRow: null,
            },
        });
    });

    it('gives the first tab of a table ordinal 1 even from openNewView', () => {
        const view = st().openNewView(C, 'orders');
        expect(tab(view).ordinal).toBe(1);
    });

    it('reports a dropped table once per tab', () => {
        const orders = st().openTable(C, 'orders', { mode: 'permanent' });
        st().duplicateTab(C, orders);
        expect(st().reconcile(C, new Map()).dropped).toEqual([
            'orders',
            'orders',
        ]);
    });
});

describe('titles and filter summaries', () => {
    const state = (filters: RowFilter[]): TableTabState => ({
        filters,
        sort: [],
        page: 1,
        perPage: 100,
        view: 'data',
        drawerRow: null,
    });

    it('summarises filters with operators, empty when there are none', () => {
        expect(
            filterSummary(
                state([
                    { column: 'status', op: 'eq', value: 'paid' },
                    { column: 'total', op: 'gt', value: '100' },
                    { column: 'note', op: 'is_null' },
                ]),
            ),
        ).toBe('status = paid · total > 100 · note is null');
        expect(filterSummary(state([]))).toBe('');
    });
});

describe('saved tabs version 2', () => {
    const KEY = 'dbsuperb.browse';
    const rehydrate = async (value: unknown) => {
        localStorage.setItem(KEY, JSON.stringify(value));
        useBrowse.setState({ byConnection: {} });
        await useBrowse.persist.rehydrate();
    };

    it('migrates v1 tabs to fresh ids with ordinal 1, keeping state, the active tab and recents', async () => {
        await rehydrate({
            version: 1,
            state: {
                byConnection: {
                    1: {
                        tabs: [
                            { id: 'universe', kind: 'universe' },
                            {
                                id: 't:users',
                                kind: 'table',
                                table: 'users',
                                preview: false,
                                state: { page: 2 },
                            },
                            {
                                id: 't:order items',
                                kind: 'table',
                                table: 'order items',
                                preview: true,
                                state: {
                                    filters: [
                                        {
                                            column: 'status',
                                            op: 'eq',
                                            value: 'paid',
                                        },
                                    ],
                                },
                            },
                        ],
                        activeId: 't:order items',
                        recents: ['order items', 'users'],
                        perPage: 500,
                    },
                },
            },
        });
        const [users, items] = tableTabs();
        expect(users).toMatchObject({ table: 'users', ordinal: 1 });
        expect(users.state.page).toBe(2);
        expect(items).toMatchObject({
            table: 'order items',
            ordinal: 1,
            preview: true,
        });
        expect(items.state.filters).toHaveLength(1);
        expect(users.id).toMatch(/^t:[A-Za-z0-9-]{1,64}$/);
        expect(items.id).not.toBe('t:order items');
        expect(active()).toBe(items.id);
        expect(st().get(C).recents).toEqual(['order items', 'users']);
        expect(st().get(C).perPage).toBe(500);
        // The later tab was active more recently.
        expect(items.activatedAt).toBeGreaterThan(users.activatedAt);
        // The migrated tabs are saved with their new ids.
        st().activate(C, users.id);
        flushBrowse();
        const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        expect(saved.version).toBe(2);
        expect(
            saved.state.byConnection[1].tabs.map((t: { id: string }) => t.id),
        ).toEqual(['universe', users.id, items.id]);
    });

    it('drops bad ids and duplicates and re-derives clashing ordinals', async () => {
        const t = (id: unknown, table: string, ordinal?: unknown) => ({
            id,
            kind: 'table',
            table,
            ordinal,
            activatedAt: 1,
            preview: false,
            state: {},
        });
        await rehydrate({
            version: 2,
            state: {
                byConnection: {
                    1: {
                        tabs: [
                            t('t:a', 'orders', 1),
                            t('t:a', 'orders', 2),
                            t('t:bad id!', 'orders', 3),
                            t(undefined, 'orders', 4),
                            t('t:b', 'orders', 1),
                            t('t:c', 'orders'),
                        ],
                        activeId: 't:c',
                        recents: [],
                        perPage: 100,
                    },
                },
            },
        });
        expect(tableTabs().map((x) => [x.id, x.ordinal])).toEqual([
            ['t:a', 1],
            ['t:b', 2],
            ['t:c', 3],
        ]);
        expect(active()).toBe('t:c');
    });

    it('falls back to the Universe tab only on corrupt v2 data', async () => {
        await rehydrate({ version: 2, state: { byConnection: { 1: 'x' } } });
        expect(tabs()).toEqual(['universe']);
        await rehydrate({
            version: 2,
            state: { byConnection: { 1: { tabs: 'x', activeId: 7 } } },
        });
        expect(tabs()).toEqual(['universe']);
        expect(active()).toBe('universe');
    });

    it("keeps another window's v1 connections, migrated, when this window writes", async () => {
        await rehydrate({
            version: 1,
            state: {
                byConnection: {
                    1: {
                        tabs: [],
                        activeId: 'universe',
                        recents: [],
                        perPage: 100,
                    },
                    2: {
                        tabs: [
                            {
                                id: 't:x y',
                                kind: 'table',
                                table: 'x y',
                                preview: false,
                                state: {},
                            },
                        ],
                        activeId: 't:x y',
                        recents: [],
                        perPage: 100,
                    },
                },
            },
        });
        st().openTable(1, 'mine', { mode: 'permanent' });
        flushBrowse();
        useBrowse.setState({ byConnection: {} });
        await useBrowse.persist.rehydrate();
        expect(tableTabs(2).map((x) => x.table)).toEqual(['x y']);
        expect(st().get(2).activeId).toBe(tableTabs(2)[0].id);
        expect(tableTabs(1).map((x) => x.table)).toEqual(['mine']);
    });
});

describe('fix round 1', () => {
    const KEY = 'dbsuperb.browse';
    const rehydrate = async (value: unknown) => {
        localStorage.setItem(KEY, JSON.stringify(value));
        useBrowse.setState({ byConnection: {} });
        await useBrowse.persist.rehydrate();
    };
    const view = (id: string, table: string, ordinal: number, at: number) => ({
        id,
        kind: 'table',
        table,
        ordinal,
        activatedAt: at,
        preview: false,
        state: { page: ordinal },
    });

    it('keeps connections that are already views when an old window saves the blob as version 1', async () => {
        await rehydrate({
            version: 1,
            state: {
                byConnection: {
                    1: {
                        tabs: [
                            { id: 'universe', kind: 'universe' },
                            view('t:aaa-1', 'orders', 1, 3),
                            view('t:bbb-2', 'orders', 2, 5),
                            view('t:ccc-3', 'users', 1, 4),
                        ],
                        activeId: 't:bbb-2',
                        recents: ['orders'],
                        perPage: 100,
                    },
                    2: {
                        tabs: [
                            { id: 'universe', kind: 'universe' },
                            {
                                id: 't:legacy',
                                kind: 'table',
                                table: 'legacy',
                                preview: false,
                                state: {},
                            },
                        ],
                        activeId: 't:legacy',
                        recents: [],
                        perPage: 100,
                    },
                },
            },
        });
        expect(
            tableTabs(1).map((t) => [t.id, t.table, t.ordinal, t.activatedAt]),
        ).toEqual([
            ['t:aaa-1', 'orders', 1, 3],
            ['t:bbb-2', 'orders', 2, 5],
            ['t:ccc-3', 'users', 1, 4],
        ]);
        expect(tableTabs(1)[1].state.page).toBe(2);
        expect(st().get(1).activeId).toBe('t:bbb-2');
        const [legacy] = tableTabs(2);
        expect(legacy.table).toBe('legacy');
        expect(legacy.id).not.toBe('t:legacy');
        expect(legacy.ordinal).toBe(1);
        expect(st().get(2).activeId).toBe(legacy.id);
    });

    it('migrates an unversioned blob', async () => {
        await rehydrate({
            state: {
                byConnection: {
                    1: {
                        tabs: [
                            {
                                id: 't:users',
                                kind: 'table',
                                table: 'users',
                                preview: false,
                                state: {},
                            },
                        ],
                        activeId: 't:users',
                        recents: [],
                        perPage: 100,
                    },
                },
            },
        });
        expect(tableTabs().map((t) => t.table)).toEqual(['users']);
        expect(active()).toBe(tableTabs()[0].id);
        expect(active()).not.toBe('t:users');
    });

    it('never opens a new view before the Universe tab', () => {
        useBrowse.setState({
            byConnection: {
                [C]: {
                    tabs: [{ id: 'universe', kind: 'universe' }],
                    activeId: 'gone',
                    recents: [],
                    perPage: 100,
                },
            },
        });
        const id = st().openNewView(C, 'orders');
        expect(tabs()).toEqual(['universe', id]);
    });

    it.each([
        ['closeTab', (a: string, b: string) => st().closeTab(C, b), ['a', 'c']],
        ['closeRight', (a: string) => st().closeRight(C, a), ['a']],
        ['closeOthers', (a: string) => st().closeOthers(C, a), ['a']],
        ['closeAll', () => st().closeAll(C), []],
    ] as const)(
        "drops the cached rows of tabs closed by %s, keeping the others'",
        (_name, close, kept) => {
            rowsCache.clear();
            const ids = ['a', 'b', 'c'].map((t) =>
                st().openTable(C, t, { mode: 'permanent' }),
            );
            for (const id of ids)
                rowsCache.set(`${C}:${id}`, {
                    requestKey: '',
                    rows: {} as never,
                    total: null,
                    scrollTop: 0,
                });
            close(ids[0], ids[1]);
            expect(
                ['a', 'b', 'c'].filter(
                    (_t, i) => rowsCache.get(`${C}:${ids[i]}`) !== undefined,
                ),
            ).toEqual(kept);
        },
    );
    it('drops the cached rows of a preview tab another preview replaces', () => {
        rowsCache.clear();
        const keep = st().openTable(C, 'a', { mode: 'permanent' });
        const first = st().openTable(C, 'b');
        for (const id of [keep, first])
            rowsCache.set(`${C}:${id}`, {
                requestKey: '',
                rows: {} as never,
                total: null,
                scrollTop: 0,
            });
        const second = st().openTable(C, 'c');
        expect(second).not.toBe(first);
        expect(rowsCache.get(`${C}:${first}`)).toBeUndefined();
        expect(rowsCache.get(`${C}:${keep}`)).toBeDefined();
    });
});
