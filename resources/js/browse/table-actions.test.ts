import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionSummary } from '@/types/connection';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';
import { useBrowse } from './browse-store';
import {
    makeTableActions,
    openTableFiltered,
    openTableTab,
} from './table-actions';

const flyTo = vi.hoisted(() => vi.fn());
vi.mock('@/universe/controller', () => ({ universe: { flyTo } }));

const connection = {
    id: 1,
    name: 'Shop',
    driver: 'pgsql',
} as ConnectionSummary;
const snapshot = makeSnapshot([{ name: 'users' }, { name: 'order items' }]);
const browse = () => useBrowse.getState().get(1);

beforeEach(() => {
    vi.clearAllMocks();
    useBrowse.setState({ byConnection: {} });
    useSqlTabs.setState({ byConnection: {} });
    useWorkspace.getState().reset();
});

describe('openTableTab', () => {
    it('opens the tab and closes the history panel', () => {
        useWorkspace.getState().setHistoryOpen(true);
        openTableTab(1, 'users', {
            mode: 'permanent',
            state: { filters: [{ column: 'id', op: 'eq', value: '1' }] },
        });
        expect(browse().activeId).toBe('t:users');
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
        openTableFiltered(1, 'users', [
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
        openTableTab(1, 'users', { mode: 'permanent', state: { filters } });
        useBrowse.getState().updateTable(1, 't:users', { page: 3 });
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

    it('shows a table in the universe', () => {
        actions.open('users', 'permanent');
        actions.showInUniverse('users');
        expect(browse().activeId).toBe('universe');
        expect(useWorkspace.getState().selected).toBe('users');
        expect(flyTo).toHaveBeenCalledWith('users');
    });
});
