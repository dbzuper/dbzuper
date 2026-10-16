import {
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { SchemaSnapshot } from '@/types/schema';
import { deOverlapCards, type CardBox } from '@/universe/card-layout';
import { pickPathTarget } from '@/universe/path-pick';
import { useWorkspace } from '@/universe/store';
import { fkColumnsByTable, stableCardKeys } from '@/universe/visible';
import { attachCardPan } from './card-pan';
import { TableCard } from './table-card';
import type { UniverseSigma } from './universe-canvas';

export const MAX_CARDS = 40;

/** Minimum vertical gap, in px, kept between two cards that share horizontal space. */
export const CARD_GAP = 8;

const EMPTY_FK = { declared: new Set<string>(), inferred: new Set<string>() };

const transformAt = (x: number, y: number) =>
    `translate(${x}px, ${y}px) translate(-50%, -50%)`;

/**
 * Puts every mounted card over its node, then nudges cards along y so none overlap. Only the cards
 * move, never the graph nodes. Unmeasured cards (width or height 0) are placed but not nudged.
 */
function placeCards(sigma: UniverseSigma, refs: Map<string, HTMLElement>) {
    const graph = sigma.getGraph();
    const boxes: CardBox[] = [];
    for (const [key, el] of refs) {
        if (!graph.hasNode(key)) continue;
        const p = sigma.graphToViewport(graph.getNodeAttributes(key));
        boxes.push({
            key,
            x: p.x,
            y: p.y,
            width: el.offsetWidth,
            height: el.offsetHeight,
        });
    }
    const measured = boxes.filter((b) => b.width > 0 && b.height > 0);
    const dy = deOverlapCards(measured, CARD_GAP);
    for (const b of boxes)
        refs.get(b.key)!.style.transform = transformAt(
            b.x,
            b.y + (dy.get(b.key) ?? 0),
        );
}

/**
 * Positions one card over its node and wires its native listeners once per mount. (An inline ref
 * callback would detach and re-attach them on every overlay render, dropping a pan in progress.)
 */
function CardSlot({
    sigma,
    nodeKey,
    refs,
    children,
}: {
    sigma: UniverseSigma;
    nodeKey: string;
    refs: Map<string, HTMLDivElement>;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        refs.set(nodeKey, el);
        // Position before paint so a new card never flashes at (0, 0) or on top of another.
        placeCards(sigma, refs);
        // Non-passive native listener so the wheel can zoom the graph from over a card.
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            sigma.getMouseLayer().dispatchEvent(new WheelEvent('wheel', e));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        const detachPan = attachCardPan(el, sigma);
        return () => {
            el.removeEventListener('wheel', onWheel);
            detachPan();
            if (refs.get(nodeKey) === el) refs.delete(nodeKey);
        };
    }, [sigma, nodeKey, refs]);
    return (
        <div ref={ref} className="absolute top-0 left-0">
            {children}
        </div>
    );
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
        (t: string) => {
            if (!pickPathTarget(snapshot, t)) useWorkspace.getState().select(t);
        },
        [snapshot],
    );
    const onFocus = useCallback(
        (t: string) => useWorkspace.getState().setFocus(t, 1),
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
            placeCards(sigma, refs.current);
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
                    <CardSlot
                        key={key}
                        sigma={sigma}
                        nodeKey={key}
                        refs={refs.current}
                    >
                        <TableCard
                            table={table}
                            fk={fk.get(key) ?? EMPTY_FK}
                            selected={selected === key}
                            onSelect={onSelect}
                            onFocus={onFocus}
                        />
                    </CardSlot>
                );
            })}
        </div>
    );
}
