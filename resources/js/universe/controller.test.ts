import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    clearPendingFlyTo,
    registerUniverse,
    universe,
    type UniverseHandle,
} from './controller';

/** A fake canvas; `flyTo` is returned separately so assertions use the mock itself. */
const fake = () => {
    const flyTo = vi.fn<(table: string) => void>();
    const fitAll = vi.fn<() => void>();
    const relayout = vi.fn<() => void>();
    const handle: UniverseHandle = {
        flyTo,
        fitNodes: vi.fn(),
        fitAll,
        relayout,
    };
    return { handle, flyTo, fitAll, relayout };
};

afterEach(() => {
    registerUniverse(null);
    clearPendingFlyTo();
});

describe('universe controller', () => {
    it('flies a mounted canvas at once', () => {
        const h = fake();
        registerUniverse(h.handle);
        universe.flyTo('users');
        expect(h.flyTo).toHaveBeenCalledWith('users');
    });

    it('keeps a flyTo asked before any canvas registered and applies it once', () => {
        universe.flyTo('users');
        universe.flyTo('orders');
        const h = fake();
        registerUniverse(h.handle);
        expect(h.flyTo).toHaveBeenCalledTimes(1);
        expect(h.flyTo).toHaveBeenCalledWith('orders');
        registerUniverse(null);
        const again = fake();
        registerUniverse(again.handle);
        expect(again.flyTo).not.toHaveBeenCalled();
    });

    it('drops the pending flyTo when cleared', () => {
        universe.flyTo('orders');
        clearPendingFlyTo();
        const h = fake();
        registerUniverse(h.handle);
        expect(h.flyTo).not.toHaveBeenCalled();
    });

    it('keeps a fit or re-layout asked before the canvas registered', () => {
        universe.fitAll();
        universe.relayout();
        const h = fake();
        registerUniverse(h.handle);
        expect(h.relayout).toHaveBeenCalledTimes(1);
        expect(h.fitAll).not.toHaveBeenCalled();
    });
});
