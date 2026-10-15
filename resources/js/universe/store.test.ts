import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from './store';

const s = () => useWorkspace.getState();

describe('workspace store', () => {
    beforeEach(() => s().reset());

    it('selects a table and optionally switches inspector tab', () => {
        s().select('orders', 'data');
        expect(s().selected).toBe('orders');
        expect(s().inspectorTab).toBe('data');
        s().select(null);
        expect(s().selected).toBeNull();
    });

    it('runs the path flow', () => {
        s().startPath('orders');
        expect(s().pathFrom).toBe('orders');
        s().completePath('products', ['orders', 'order_items', 'products']);
        expect(s().pathTo).toBe('products');
        expect(s().path).toEqual(['orders', 'order_items', 'products']);
        s().clearPath();
        expect([s().pathFrom, s().pathTo, s().path]).toEqual([
            null,
            null,
            null,
        ]);
    });

    it('records an empty path when none exists', () => {
        s().startPath('a');
        s().completePath('b', null);
        expect(s().path).toEqual([]);
    });

    it('toggles inferred relationships and focus', () => {
        expect(s().showInferred).toBe(true);
        s().toggleInferred();
        expect(s().showInferred).toBe(false);
        s().setFocus('orders', 2);
        expect(s().focus).toEqual({ table: 'orders', depth: 2 });
        s().setFocus(null);
        expect(s().focus).toBeNull();
    });

    it('only updates zoom level when it changes', () => {
        let calls = 0;
        const unsub = useWorkspace.subscribe(() => calls++);
        s().setZoomLevel('closeup');
        s().setZoomLevel('closeup');
        unsub();
        expect(calls).toBe(1);
    });
});

describe('data filter', () => {
    beforeEach(() => s().reset());

    it('openDataFilter selects the table, opens the data tab and stores the filter', () => {
        s().openDataFilter('users', [{ column: 'id', value: '2' }]);
        expect(s().selected).toBe('users');
        expect(s().inspectorTab).toBe('data');
        expect(s().dataFilter).toEqual({
            table: 'users',
            filters: [{ column: 'id', value: '2' }],
        });
    });

    it('openDataFilter closes the history panel so the Data tab shows', () => {
        s().setHistoryOpen(true);
        s().openDataFilter('users', [{ column: 'id', value: '2' }]);
        expect(s().historyOpen).toBe(false);
    });

    it('clearDataFilter and reset drop the filter', () => {
        s().openDataFilter('users', [{ column: 'id', value: '2' }]);
        s().clearDataFilter();
        expect(s().dataFilter).toBeNull();
        s().openDataFilter('users', [{ column: 'id', value: '2' }]);
        s().reset();
        expect(s().dataFilter).toBeNull();
    });
});

describe('multi-column data filter', () => {
    beforeEach(() => s().reset());

    it('stores several column/value pairs and allows the records view', () => {
        s().setView('records');
        expect(s().view).toBe('records');
        s().openDataFilter('order_items', [
            { column: 'order_id', value: '1' },
            { column: 'shop_id', value: '2' },
        ]);
        expect(s().dataFilter?.filters).toHaveLength(2);
    });
});
