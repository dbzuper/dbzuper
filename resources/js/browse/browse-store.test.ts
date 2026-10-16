import { beforeEach, describe, expect, it } from 'vitest';
import { tableTabId, useBrowse } from './browse-store';

const C = 1;
const st = () => useBrowse.getState();
const tabs = () =>
    st()
        .get(C)
        .tabs.map((t) => t.id);
const active = () => st().get(C).activeId;

beforeEach(() => {
    localStorage.clear();
    useBrowse.setState({ byConnection: {} });
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
    it('promotes a preview on filter, sort, page or page-size changes but not on view or drawer changes', () => {
        st().openTable(C, 'users');
        const id = tableTabId('users');
        st().updateTable(C, id, { view: 'structure', drawerRow: 2 });
        let tab = st().get(C).tabs[1];
        expect(tab.kind === 'table' && tab.preview).toBe(true);
        st().updateTable(C, id, { page: 2 });
        tab = st().get(C).tabs[1];
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
});
