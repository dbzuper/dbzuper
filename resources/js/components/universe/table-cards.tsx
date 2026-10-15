import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SchemaSnapshot } from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { fkColumnsByTable, stableCardKeys } from '@/universe/visible';
import { TableCard } from './table-card';
import type { UniverseSigma } from './universe-canvas';

export const MAX_CARDS = 40;

const EMPTY_FK = { declared: new Set<string>(), inferred: new Set<string>() };

function place(sigma: UniverseSigma, key: string, el: HTMLElement) {
    const graph = sigma.getGraph();
    if (!graph.hasNode(key)) return;
    const p = sigma.graphToViewport(graph.getNodeAttributes(key));
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
}

export function TableCards({
    sigma,
    snapshot,
}: {
    sigma: UniverseSigma;
    snapshot: SchemaSnapshot;
}) {
    const zoomLevel = useWorkspace((s) => s.zoomLevel);
    const selected = useWorkspace((s) => s.selected);
    const onSelect = useCallback(
        (t: string) => useWorkspace.getState().select(t),
        [],
    );
    const [keys, setKeys] = useState<string[]>([]);
    const refs = useRef(new Map<string, HTMLDivElement>());
    const tables = useMemo(
        () => new Map(snapshot.tables.map((t) => [t.name, t])),
        [snapshot],
    );
    const fk = useMemo(() => fkColumnsByTable(snapshot), [snapshot]);

    useEffect(() => {
        if (zoomLevel !== 'closeup') {
            setKeys([]);
            return;
        }
        const graph = sigma.getGraph();
        const update = () => {
            const { width, height } = sigma.getDimensions();
            const points: { key: string; x: number; y: number }[] = [];
            graph.forEachNode((key, attrs) => {
                if (sigma.getNodeDisplayData(key)?.visibility === 'hidden')
                    return;
                const p = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
                points.push({ key, x: p.x, y: p.y });
            });
            const next = stableCardKeys(points, width, height, MAX_CARDS);
            setKeys((prev) =>
                prev.length === next.length &&
                prev.every((k, i) => k === next[i])
                    ? prev
                    : next,
            );
            for (const p of points) {
                const el = refs.current.get(p.key);
                if (el)
                    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
            }
        };
        update();
        sigma.on('afterRender', update);
        return () => {
            sigma.removeListener('afterRender', update);
        };
    }, [sigma, zoomLevel]);

    if (zoomLevel !== 'closeup') return null;

    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {keys.map((key) => {
                const table = tables.get(key);
                if (!table) return null;
                return (
                    <div
                        key={key}
                        className="absolute top-0 left-0"
                        ref={(el) => {
                            if (!el) return;
                            refs.current.set(key, el);
                            // Position immediately so a new card never flashes at (0, 0).
                            place(sigma, key, el);
                            // Non-passive native listener so the wheel can zoom the graph from over a card.
                            const onWheel = (e: WheelEvent) => {
                                e.preventDefault();
                                sigma
                                    .getMouseLayer()
                                    .dispatchEvent(new WheelEvent('wheel', e));
                            };
                            el.addEventListener('wheel', onWheel, {
                                passive: false,
                            });
                            return () => {
                                el.removeEventListener('wheel', onWheel);
                                if (refs.current.get(key) === el)
                                    refs.current.delete(key);
                            };
                        }}
                    >
                        <TableCard
                            table={table}
                            fk={fk.get(key) ?? EMPTY_FK}
                            selected={selected === key}
                            onSelect={onSelect}
                        />
                    </div>
                );
            })}
        </div>
    );
}
