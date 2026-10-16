import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from './store';

const s = () => useWorkspace.getState();

describe('workspace store', () => {
    beforeEach(() => s().reset());

    it('selects a table and optionally switches inspector tab', () => {
        s().select('orders', 'ddl');
        expect(s().selected).toBe('orders');
        expect(s().inspectorTab).toBe('ddl');
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
