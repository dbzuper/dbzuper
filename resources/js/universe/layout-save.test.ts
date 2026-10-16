import { describe, expect, it, vi } from 'vitest';
import type { LayoutPositionEntry } from '@/types/schema';
import {
    changedEntries,
    chunkEntries,
    createLayoutSaver,
    MAX_CHUNK_BYTES,
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

describe('chunkEntries', () => {
    it('splits a 2,000-entry change set into bodies under 60 KB', () => {
        const entries = Array.from({ length: 2000 }, (_, i) =>
            entry(`some_fairly_long_table_name_${i}`, i * 1.123456789),
        );
        const chunks = chunkEntries(entries);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.flat()).toEqual(entries);
        for (const c of chunks) expect(bytes(c)).toBeLessThan(MAX_CHUNK_BYTES);
        expect(MAX_CHUNK_BYTES).toBeLessThanOrEqual(60_000);
    });

    it('measures bytes, not characters', () => {
        const entries = Array.from({ length: 3000 }, (_, i) =>
            entry(`régions_${i}_${'é'.repeat(20)}`),
        );
        for (const c of chunkEntries(entries))
            expect(bytes(c)).toBeLessThan(MAX_CHUNK_BYTES);
    });

    it('returns no chunks for nothing and one for a few', () => {
        expect(chunkEntries([])).toEqual([]);
        expect(chunkEntries([entry('a')])).toEqual([[entry('a')]]);
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
        const onError = vi.fn();
        const saver = createLayoutSaver(1, send, onError);
        return { saver, send, onError };
    };

    it('sends only the positions changed since the last save, merged and kept alive', () => {
        const { saver, send } = make();
        saver.baseline([entry('a'), entry('b')]);
        saver.saveChanged([entry('a'), entry('b', 5)], saver.generation());
        expect(send).toHaveBeenCalledExactlyOnceWith(1, [entry('b', 5)], {
            keepalive: true,
            merge: true,
        });
        saver.saveChanged([entry('a'), entry('b', 5)], saver.generation());
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('chunks a large change set into several keepalive requests', () => {
        const { saver, send } = make();
        saver.baseline([]);
        const entries = Array.from({ length: 2000 }, (_, i) =>
            entry(`some_fairly_long_table_name_${i}`, i + 0.5),
        );
        saver.saveChanged(entries, saver.generation());
        expect(send.mock.calls.length).toBeGreaterThan(1);
        expect(send.mock.calls.flatMap((c) => c[1])).toEqual(entries);
    });

    it('drops a save made under an older layout generation', () => {
        const { saver, send } = make();
        saver.baseline([entry('a')]);
        const stale = saver.generation();
        saver.saveFull([entry('a', 7)]);
        send.mockClear();
        saver.saveChanged([entry('a', 1)], stale);
        expect(send).not.toHaveBeenCalled();
    });

    it('replaces the stored layout on a full save, without keepalive or merge', () => {
        const { saver, send } = make();
        saver.saveFull([entry('a'), entry('b')]);
        expect(send).toHaveBeenCalledExactlyOnceWith(
            1,
            [entry('a'), entry('b')],
            { keepalive: false, merge: false },
        );
    });

    it('resends a failed chunk next time and reports the error once', async () => {
        const { saver, send, onError } = make();
        send.mockRejectedValueOnce(new Error('offline'));
        saver.baseline([entry('a')]);
        saver.saveChanged([entry('a', 2)], saver.generation());
        await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
        saver.saveChanged([entry('a', 2)], saver.generation());
        expect(send).toHaveBeenCalledTimes(2);
    });
});
