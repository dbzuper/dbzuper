import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
    list: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
}));
vi.mock('@/lib/pins-api', () => ({ pinsApi: api }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { toast } from 'sonner';
import { usePins } from './pins-store';

beforeEach(() => {
    vi.clearAllMocks();
    usePins.setState({ byConnection: {} });
    localStorage.clear();
});

describe('gathering all seven', () => {
    const pinsUpTo = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
            id: i + 1,
            table: `t${i + 1}`,
            position: i + 1,
        }));

    it('makes a wish once, when the seventh pin is saved', async () => {
        api.list.mockResolvedValue({ pins: pinsUpTo(6) });
        await usePins.getState().load('7');
        api.add.mockResolvedValue({
            pin: { id: 7, table: 't7', position: 7 },
        });

        await usePins.getState().toggle('7', 't7');

        expect(toast).toHaveBeenCalledExactlyOnceWith(
            "You've gathered all seven. Make a wish.",
        );

        // Unpinning and pinning a seventh again does not repeat it.
        api.remove.mockResolvedValue(null);
        await usePins.getState().toggle('7', 't7');
        await usePins.getState().toggle('7', 't7');
        expect(toast).toHaveBeenCalledTimes(1);
    });

    it('stays quiet below seven and when the pin is refused', async () => {
        api.list.mockResolvedValue({ pins: pinsUpTo(5) });
        await usePins.getState().load('7');
        api.add.mockResolvedValue({
            pin: { id: 6, table: 't6', position: 6 },
        });
        await usePins.getState().toggle('7', 't6');
        api.add.mockRejectedValue(new Error('500'));
        await usePins.getState().toggle('7', 't7');

        expect(toast).not.toHaveBeenCalled();
    });
});

describe('usePins', () => {
    it('keeps the pins of each database of a server apart', async () => {
        api.list.mockImplementation((ref: string) =>
            Promise.resolve({
                pins: [
                    {
                        id: 1,
                        table: ref === '5:a' ? 'in_a' : 'in_b',
                        position: 1,
                    },
                ],
            }),
        );
        await usePins.getState().load('5:a');
        await usePins.getState().load('5:b');

        expect(usePins.getState().isPinned('5:a', 'in_a')).toBe(true);
        expect(usePins.getState().isPinned('5:b', 'in_a')).toBe(false);
        expect(api.list).toHaveBeenCalledWith('5:b');
    });

    it('loads, pins optimistically and unpins', async () => {
        api.list.mockResolvedValue({
            pins: [{ id: 1, table: 'users', position: 1 }],
        });
        await usePins.getState().load('7');
        api.add.mockResolvedValue({
            pin: { id: 2, table: 'orders', position: 2 },
        });
        const pending = usePins.getState().toggle('7', 'orders');
        expect(usePins.getState().isPinned('7', 'orders')).toBe(true);
        await pending;
        expect(usePins.getState().byConnection[7].map((p) => p.id)).toEqual([
            1, 2,
        ]);
        api.remove.mockResolvedValue(null);
        await usePins.getState().toggle('7', 'users');
        expect(api.remove).toHaveBeenCalledWith('7', 1);
        expect(usePins.getState().isPinned('7', 'users')).toBe(false);
    });

    it('rolls back and tells the user when the server refuses', async () => {
        api.list.mockResolvedValue({ pins: [] });
        await usePins.getState().load('7');
        api.add.mockRejectedValue(new Error('500'));
        await usePins.getState().toggle('7', 'orders');
        expect(usePins.getState().isPinned('7', 'orders')).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Could not update pins.');
    });

    it('reorders by table name', async () => {
        api.list.mockResolvedValue({
            pins: [
                { id: 1, table: 'a', position: 1 },
                { id: 2, table: 'b', position: 2 },
            ],
        });
        await usePins.getState().load('7');
        api.reorder.mockResolvedValue({
            pins: [
                { id: 2, table: 'b', position: 1 },
                { id: 1, table: 'a', position: 2 },
            ],
        });
        await usePins.getState().reorder('7', ['b', 'a']);
        expect(api.reorder).toHaveBeenCalledWith('7', [2, 1]);
        expect(usePins.getState().byConnection[7].map((p) => p.table)).toEqual([
            'b',
            'a',
        ]);
    });

    it('removes the real pin when toggled again while the add is in flight', async () => {
        api.list.mockResolvedValue({ pins: [] });
        await usePins.getState().load('7');
        let resolveAdd!: (v: unknown) => void;
        api.add.mockReturnValue(new Promise((r) => (resolveAdd = r)));
        api.remove.mockResolvedValue(null);
        const first = usePins.getState().toggle('7', 'orders');
        const second = usePins.getState().toggle('7', 'orders');
        resolveAdd({ pin: { id: 5, table: 'orders', position: 1 } });
        await Promise.all([first, second]);
        expect(api.add).toHaveBeenCalledTimes(1);
        expect(api.remove).toHaveBeenCalledWith('7', 5);
        expect(usePins.getState().isPinned('7', 'orders')).toBe(false);
    });

    it('keeps a pending new pin when reordering during the add', async () => {
        api.list.mockResolvedValue({
            pins: [
                { id: 1, table: 'a', position: 1 },
                { id: 2, table: 'b', position: 2 },
            ],
        });
        await usePins.getState().load('7');
        let resolveAdd!: (v: unknown) => void;
        api.add.mockReturnValue(new Promise((r) => (resolveAdd = r)));
        api.reorder.mockResolvedValue({
            pins: [
                { id: 2, table: 'b', position: 1 },
                { id: 1, table: 'a', position: 2 },
                { id: 9, table: 'c', position: 3 },
            ],
        });
        const add = usePins.getState().toggle('7', 'c');
        const reorder = usePins.getState().reorder('7', ['b', 'a', 'c']);
        resolveAdd({ pin: { id: 9, table: 'c', position: 3 } });
        await Promise.all([add, reorder]);
        expect(api.reorder).toHaveBeenCalledWith('7', [2, 1, 9]);
        expect(usePins.getState().byConnection[7].map((p) => p.table)).toEqual([
            'b',
            'a',
            'c',
        ]);
    });
});
