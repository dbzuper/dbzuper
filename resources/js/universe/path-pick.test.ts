import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from './__fixtures__/snapshot';
import { pickPathTarget } from './path-pick';
import { useWorkspace } from './store';

const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));

const snap = makeSnapshot(
    [{ name: 'a' }, { name: 'b' }],
    [{ from_table: 'b', to_table: 'a' }],
);
const s = () => useWorkspace.getState();

beforeEach(() => {
    s().reset();
    toast.mockClear();
});

describe('pickPathTarget', () => {
    it('does nothing without a pending path', () => {
        expect(pickPathTarget(snap, 'a')).toBe(false);
        expect(s().path).toBeNull();
    });

    it('completes the path to a different table', () => {
        s().startPath('a');
        expect(pickPathTarget(snap, 'b')).toBe(true);
        expect(s().path).toEqual(['a', 'b']);
    });

    it('cancels the pick when the start table is chosen again', () => {
        s().startPath('a');
        expect(pickPathTarget(snap, 'a')).toBe(true);
        expect(s().pathFrom).toBeNull();
        expect(s().path).toBeNull();
        expect(toast).toHaveBeenCalledWith(
            'Pick a different table to find a path.',
        );
    });
});
