import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LayoutPositionEntry, SchemaSnapshot } from '@/types/schema';
import { makeSnapshot } from './__fixtures__/snapshot';
import { useUniverseModel } from './use-universe-model';

const snap = (names: string[]) =>
    makeSnapshot(
        names.map((name) => ({ name })),
        names.length > 1 ? [{ from_table: names[0], to_table: names[1] }] : [],
    );

type Props = { s: SchemaSnapshot | null; saved: LayoutPositionEntry[] | null };

function setup(initial: Props) {
    const onLaidOut = vi.fn();
    const hook = renderHook(
        (p: Props) => useUniverseModel(p.s, p.saved, onLaidOut),
        {
            initialProps: initial,
        },
    );
    return { onLaidOut, ...hook };
}

describe('useUniverseModel', () => {
    it('lays out on first build and reports positions once', async () => {
        const { result, onLaidOut } = setup({
            s: snap(['a', 'b', 'c']),
            saved: [],
        });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.model!.graph.nodes().sort()).toEqual([
            'a',
            'b',
            'c',
        ]);
        result.current.model!.graph.forEachNode((_k, attrs) => {
            expect(Number.isFinite(attrs.x) && Number.isFinite(attrs.y)).toBe(
                true,
            );
        });
        expect(onLaidOut).toHaveBeenCalledTimes(1);
    });

    it('reuses a complete saved layout without reporting', async () => {
        const saved = [
            { table: 'a', x: 1, y: 2, pinned: false },
            { table: 'b', x: 3, y: 4, pinned: true },
        ];
        const { result, onLaidOut } = setup({ s: snap(['a', 'b']), saved });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const g = result.current.model!.graph;
        expect(g.getNodeAttribute('a', 'x')).toBe(1);
        expect(g.getNodeAttribute('b', 'y')).toBe(4);
        expect(g.getNodeAttribute('b', 'pinned')).toBe(true);
        expect(onLaidOut).not.toHaveBeenCalled();
    });

    it('relayout keeps graph identity and reports again', async () => {
        const { result, onLaidOut } = setup({
            s: snap(['a', 'b', 'c']),
            saved: [],
        });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const graph = result.current.model!.graph;
        act(() => result.current.relayout());
        await waitFor(() => expect(onLaidOut).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.model!.graph).toBe(graph);
    });

    it('rebuilds for a new snapshot after a relayout', async () => {
        const first = snap(['a', 'b', 'c']);
        const { result, rerender } = setup({ s: first, saved: [] });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        act(() => result.current.relayout());
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const old = result.current.model!.graph;
        rerender({ s: snap(['b', 'c', 'd']), saved: [] });
        await waitFor(() => expect(result.current.model!.graph).not.toBe(old));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.model!.graph.nodes().sort()).toEqual([
            'b',
            'c',
            'd',
        ]);
    });

    it('ignores new savedEntries for the same snapshot', async () => {
        const s = snap(['a', 'b', 'c']);
        const { result, rerender, onLaidOut } = setup({ s, saved: [] });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const graph = result.current.model!.graph;
        rerender({ s, saved: [{ table: 'a', x: 9, y: 9, pinned: false }] });
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.model!.graph).toBe(graph);
        expect(onLaidOut).toHaveBeenCalledTimes(1);
    });

    it('is ready for an empty snapshot without reporting', async () => {
        const { result, onLaidOut } = setup({ s: snap([]), saved: [] });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(onLaidOut).not.toHaveBeenCalled();
    });

    it('returns to idle when the snapshot becomes null', async () => {
        const { result, rerender } = setup({ s: snap(['a', 'b']), saved: [] });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        rerender({ s: null, saved: [] });
        await waitFor(() => expect(result.current.status).toBe('idle'));
        expect(result.current.model).toBeNull();
    });
});
