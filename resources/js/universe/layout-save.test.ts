import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutPositionEntry } from '@/types/schema';
import {
    changedEntries,
    createLayoutSaver,
    MAX_KEEPALIVE_BYTES,
    splitByBytes,
} from './layout-save';

const entry = (table: string, x = 0, pinned = false): LayoutPositionEntry => ({
    table,
    x,
    y: 0,
    pinned,
});
const bytes = (entries: LayoutPositionEntry[]) =>
    new TextEncoder().encode(
        JSON.stringify({ merge: true, positions: entries }),
    ).length;
const many = (n: number, prefix = 'some_fairly_long_table_name_') =>
    Array.from({ length: n }, (_, i) => entry(`${prefix}${i}`, i + 0.123456));

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('splitByBytes', () => {
    it('keeps the body under the keepalive budget and returns the rest', () => {
        const entries = many(2000);
        const { fit, rest } = splitByBytes(entries);
        expect(fit.length).toBeGreaterThan(0);
        expect(rest.length).toBeGreaterThan(0);
        expect([...fit, ...rest]).toEqual(entries);
        expect(bytes(fit)).toBeLessThan(MAX_KEEPALIVE_BYTES);
        expect(MAX_KEEPALIVE_BYTES).toBeLessThan(64 * 1024);
    });

    it('measures bytes, not characters', () => {
        const entries = many(3000, `régions_${'é'.repeat(20)}_`);
        expect(bytes(splitByBytes(entries).fit)).toBeLessThan(
            MAX_KEEPALIVE_BYTES,
        );
    });

    it('fits everything when it is small', () => {
        expect(splitByBytes([entry('a')])).toEqual({
            fit: [entry('a')],
            rest: [],
        });
        expect(splitByBytes([])).toEqual({ fit: [], rest: [] });
    });
});

describe('changedEntries', () => {
    it('keeps only positions that moved or changed pin state', () => {
        const last = new Map([
            ['a', entry('a', 1)],
            ['b', entry('b', 2)],
            ['c', entry('c', 3)],
        ]);
        const next = [
            entry('a', 1),
            entry('b', 9),
            entry('c', 3, true),
            entry('d', 4),
        ];
        expect(changedEntries(last, next).map((e) => e.table)).toEqual([
            'b',
            'c',
            'd',
        ]);
    });
});

describe('createLayoutSaver', () => {
    const make = () => {
        const send = vi.fn().mockResolvedValue({ saved: true });
        const onProblem = vi.fn();
        const saver = createLayoutSaver('1', send, onProblem);
        return { saver, send, onProblem };
    };
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it('sends a normal save as a plain merge of only the changed positions', async () => {
        const { saver, send } = make();
        saver.baseline([entry('a'), entry('b')]);
        saver.saveChanged([entry('a'), entry('b', 5)], saver.generation());
        await settle();
        expect(send).toHaveBeenCalledExactlyOnceWith('1', [entry('b', 5)], {
            keepalive: false,
            merge: true,
        });
        saver.saveChanged([entry('a'), entry('b', 5)], saver.generation());
        await settle();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('does not chunk a large normal save', async () => {
        const { saver, send } = make();
        saver.baseline([]);
        saver.saveChanged(many(2000), saver.generation());
        await settle();
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][1]).toHaveLength(2000);
        expect(send.mock.calls[0][2].keepalive).toBe(false);
    });

    it('drops a save made under an older layout generation', async () => {
        const { saver, send } = make();
        saver.baseline([entry('a')]);
        const stale = saver.generation();
        saver.saveFull([entry('a', 7)]);
        await settle();
        send.mockClear();
        saver.saveChanged([entry('a', 1)], stale);
        await settle();
        expect(send).not.toHaveBeenCalled();
    });

    it('replaces the stored layout on a full save, without keepalive or merge', () => {
        const { saver, send } = make();
        saver.saveFull([entry('a'), entry('b')]);
        expect(send).toHaveBeenCalledExactlyOnceWith(
            '1',
            [entry('a'), entry('b')],
            { keepalive: false, merge: false },
        );
    });

    it('queues a merge behind a full save in flight and coalesces merges', async () => {
        const { saver, send } = make();
        let finishFull!: () => void;
        send.mockImplementationOnce(
            () => new Promise<void>((r) => (finishFull = r)),
        );
        saver.saveFull([entry('a'), entry('b')]);
        const gen = saver.generation();
        saver.saveChanged([entry('a', 1), entry('b')], gen);
        saver.saveChanged([entry('a', 2), entry('b', 3)], gen);
        await settle();
        expect(send).toHaveBeenCalledTimes(1);
        finishFull();
        await settle();
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[1][1]).toEqual([entry('a', 2), entry('b', 3)]);
        expect(send.mock.calls[1][2]).toEqual({
            keepalive: false,
            merge: true,
        });
    });

    it('never has two requests in flight', async () => {
        const { saver, send } = make();
        let inFlight = 0;
        let peak = 0;
        send.mockImplementation(async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await settle();
            inFlight--;
        });
        saver.baseline([]);
        saver.saveChanged([entry('a')], saver.generation());
        await settle();
        saver.saveChanged([entry('b')], saver.generation());
        await settle();
        saver.saveChanged([entry('c')], saver.generation());
        await settle();
        await settle();
        expect(peak).toBe(1);
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('resends a failed merge next time and reports the problem once', async () => {
        const { saver, send, onProblem } = make();
        send.mockRejectedValueOnce(new Error('offline'));
        saver.baseline([entry('a')]);
        saver.saveChanged([entry('a', 2)], saver.generation());
        await settle();
        expect(onProblem).toHaveBeenCalledExactlyOnceWith('failed');
        saver.saveChanged([entry('a', 2)], saver.generation());
        await settle();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('makes the next save after a failed full save a merge of everything', async () => {
        const { saver, send, onProblem } = make();
        send.mockRejectedValueOnce(new Error('aborted'));
        saver.saveFull([entry('a'), entry('b')]);
        await settle();
        expect(onProblem).toHaveBeenCalledWith('failed');
        saver.saveChanged([entry('a'), entry('b')], saver.generation());
        await settle();
        expect(send).toHaveBeenLastCalledWith('1', [entry('a'), entry('b')], {
            keepalive: false,
            merge: true,
        });
    });

    it('stops resending entries after a 422 size-cap answer and says so once', async () => {
        const { saver, send, onProblem } = make();
        send.mockRejectedValueOnce(
            Object.assign(new Error('too big'), { status: 422 }),
        );
        saver.baseline([]);
        saver.saveChanged([entry('a')], saver.generation());
        await settle();
        expect(onProblem).toHaveBeenCalledExactlyOnceWith('too_large');
        saver.saveChanged([entry('a')], saver.generation());
        await settle();
        expect(send).toHaveBeenCalledTimes(1);
    });

    describe('unload', () => {
        it('flushes the queue with keepalive, claiming it before the normal send', async () => {
            const { saver, send } = make();
            saver.baseline([entry('a')]);
            saver.saveChanged([entry('a', 4)], saver.generation());
            saver.unload();
            await settle();
            expect(send).toHaveBeenCalledExactlyOnceWith('1', [entry('a', 4)], {
                keepalive: true,
                merge: true,
            });
            expect(localStorage.length).toBe(0);
        });

        it('sends a 150 KB change set within the keepalive budget and keeps the rest in localStorage', async () => {
            const { saver, send } = make();
            saver.baseline([]);
            const entries = many(2500);
            expect(bytes(entries)).toBeGreaterThan(150_000);
            saver.saveChanged(entries, saver.generation());
            saver.unload();
            await settle();
            const kept = send.mock.calls.filter((c) => c[2].keepalive);
            const total = kept.reduce((n, c) => n + bytes(c[1]), 0);
            expect(total).toBeLessThan(64 * 1024);
            const stored = JSON.parse(
                localStorage.getItem('dbzuper.layout-pending.1')!,
            ) as LayoutPositionEntry[];
            expect(stored.length).toBeGreaterThan(0);
            expect(kept.flatMap((c) => c[1]).length + stored.length).toBe(2500);
        });

        it('includes a full save still in flight', async () => {
            const { saver, send } = make();
            send.mockImplementationOnce(() => new Promise(() => undefined));
            saver.saveFull([entry('a'), entry('b')]);
            saver.unload();
            await settle();
            expect(send).toHaveBeenLastCalledWith(
                '1',
                [entry('a'), entry('b')],
                {
                    keepalive: true,
                    merge: true,
                },
            );
        });
    });

    describe('replayStored', () => {
        it('replays kept entries as a merge, clears them and resolves when done', async () => {
            localStorage.setItem(
                'dbzuper.layout-pending.1',
                JSON.stringify([entry('a', 9), entry('b', 8)]),
            );
            const { saver, send } = make();
            await saver.replayStored();
            expect(send).toHaveBeenCalledExactlyOnceWith(
                '1',
                [entry('a', 9), entry('b', 8)],
                { keepalive: false, merge: true },
            );
            expect(
                localStorage.getItem('dbzuper.layout-pending.1'),
            ).toBeNull();
        });

        it('keeps the entries when the replay fails', async () => {
            localStorage.setItem(
                'dbzuper.layout-pending.1',
                JSON.stringify([entry('a', 9)]),
            );
            const { saver, send } = make();
            send.mockRejectedValueOnce(new Error('offline'));
            await saver.replayStored();
            expect(
                JSON.parse(localStorage.getItem('dbzuper.layout-pending.1')!),
            ).toEqual([entry('a', 9)]);
        });

        it('resolves at once with nothing stored', async () => {
            const { saver, send } = make();
            await saver.replayStored();
            expect(send).not.toHaveBeenCalled();
        });

        it('is per connection', async () => {
            localStorage.setItem(
                'dbzuper.layout-pending.2',
                JSON.stringify([entry('a')]),
            );
            const { saver, send } = make();
            await saver.replayStored();
            expect(send).not.toHaveBeenCalled();
        });
    });
});
