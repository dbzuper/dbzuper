import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionSummary } from '@/types/connection';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';
import { useBrowse } from './browse-store';
import {
    makeTableActions,
    openTableFiltered,
    openTableInNewTab,
    openTableTab,
} from './table-actions';
import { tableTabOf } from '@/test/browse-tabs';

const flyTo = vi.hoisted(() => vi.fn());
vi.mock('@/universe/controller', () => ({ universe: { flyTo } }));

const connection = {
    id: 1,
    ref: '1',
    name: 'Shop',
    driver: 'pgsql',
} as ConnectionSummary;
const snapshot = makeSnapshot([{ name: 'users' }, { name: 'order items' }]);
const browse = () => useBrowse.getState().get('1');

beforeEach(() => {
    vi.clearAllMocks();
    useBrowse.setState({ byConnection: {} });
    useSqlTabs.setState({ byConnection: {} });
    useWorkspace.getState().reset();
});

describe('openTableTab', () => {
    it('opens the tab and closes the history panel', () => {
        useWorkspace.getState().setHistoryOpen(true);
        openTableTab('1', 'users', {
            mode: 'permanent',
            state: { filters: [{ column: 'id', op: 'eq', value: '1' }] },
        });
        expect(browse().activeId).toBe(tableTabOf('1', 'users')?.id);
        expect(browse().tabs[1]).toMatchObject({
            preview: false,
            state: { filters: [{ column: 'id', op: 'eq', value: '1' }] },
        });
        expect(useWorkspace.getState().historyOpen).toBe(false);
    });
});

describe('openTableFiltered', () => {
    it('opens a permanent tab with one eq filter per column/value pair', () => {
        useWorkspace.getState().setHistoryOpen(true);
        openTableFiltered('1', 'users', [
            { column: 'order_id', value: '1' },
            { column: 'shop_id', value: '2' },
        ]);
        expect(browse().tabs[1]).toMatchObject({
            preview: false,
            state: {
                filters: [
                    { column: 'order_id', op: 'eq', value: '1' },
                    { column: 'shop_id', op: 'eq', value: '2' },
                ],
            },
        });
        expect(useWorkspace.getState().historyOpen).toBe(false);
    });
});

describe('several views of one table', () => {
    it('filters the latest tab of the target table instead of opening another', () => {
        const first = useBrowse
            .getState()
            .openTable('1', 'users', { mode: 'permanent' });
        const second = useBrowse.getState().duplicateTab('1', first);
        useBrowse.getState().activate('1', 'universe');
        openTableFiltered('1', 'users', [{ column: 'id', value: '4' }]);
        expect(browse().tabs).toHaveLength(3);
        expect(browse().activeId).toBe(second);
        expect(tableTabOf('1', 'users', 2)?.state.filters).toEqual([
            { column: 'id', op: 'eq', value: '4' },
        ]);
        expect(tableTabOf('1', 'users')?.state.filters).toEqual([]);
    });

    it('opens a new default view of an open table in a new tab, else a background tab', () => {
        useWorkspace.getState().setHistoryOpen(true);
        openTableInNewTab('1', 'order items');
        expect(browse().activeId).toBe('universe');
        expect(tableTabOf('1', 'order items')).toMatchObject({
            preview: false,
        });
        useBrowse
            .getState()
            .updateTable('1', tableTabOf('1', 'order items')!.id, {
                filters: [{ column: 'id', op: 'eq', value: '1' }],
            });
        openTableInNewTab('1', 'order items');
        const view = tableTabOf('1', 'order items', 2);
        expect(browse().activeId).toBe(view?.id);
        expect(view).toMatchObject({ preview: false, state: { filters: [] } });
        expect(useWorkspace.getState().historyOpen).toBe(false);
    });
});

describe('makeTableActions', () => {
    const actions = makeTableActions(connection, snapshot);

    it('opens a table in the requested mode', () => {
        actions.open('users', 'preview');
        expect(browse().tabs[1]).toMatchObject({ preview: true });
    });

    it('opens the structure view permanently', () => {
        actions.structure('users');
        expect(browse().tabs[1]).toMatchObject({
            preview: false,
            state: { view: 'structure' },
        });
    });

    it('keeps the filters of an already-open tab when switching it to structure', () => {
        const filters = [{ column: 'id', op: 'eq' as const, value: '1' }];
        openTableTab('1', 'users', { mode: 'permanent', state: { filters } });
        useBrowse
            .getState()
            .updateTable('1', tableTabOf('1', 'users')!.id, { page: 3 });
        actions.structure('users');
        expect(browse().tabs[1]).toMatchObject({
            state: { view: 'structure', filters, page: 3 },
        });
    });

    it('opens a quoted SELECT in a new SQL tab', () => {
        actions.openInSql('order items');
        const sql = useSqlTabs.getState().byConnection[1];
        expect(sql.tabs.find((t) => t.id === sql.activeId)?.sql).toBe(
            'SELECT * FROM "order items" LIMIT 100',
        );
        expect(useWorkspace.getState().dockOpen).toBe(true);
    });

    it('opens the editor tab linked to the latest tab of an open table', () => {
        openTableTab('1', 'users', { mode: 'permanent' });
        const first = tableTabOf('1', 'users')!.id;
        const second = useBrowse.getState().duplicateTab('1', first);
        actions.openInSql('users');
        actions.openInSql('users');
        const sql = useSqlTabs.getState().byConnection[1];
        const linked = sql.tabs.filter((t) => t.link);
        expect(linked).toHaveLength(1);
        expect(linked[0]).toMatchObject({
            title: 'users (2)',
            link: { browseTabId: second },
        });
        expect(sql.activeId).toBe(linked[0].id);
        expect(useWorkspace.getState().dockOpen).toBe(true);
    });

    it('shows a table in the universe', () => {
        actions.open('users', 'permanent');
        actions.showInUniverse('users');
        expect(browse().activeId).toBe('universe');
        expect(useWorkspace.getState().selected).toBe('users');
        expect(flyTo).toHaveBeenCalledWith('users');
    });
});
