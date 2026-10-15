import { useEffect, useMemo, useRef } from 'react';
import type Sigma from 'sigma';
import type { ClusterInfo } from '@/universe/clusters';
import type {
    RelationEdgeAttributes,
    SchemaGraph,
    TableNodeAttributes,
} from '@/universe/graph';
import { useWorkspace } from '@/universe/store';

type Props = {
    sigma: Sigma<TableNodeAttributes, RelationEdgeAttributes>;
    clusters: ClusterInfo[];
    graph: SchemaGraph;
};

export function ClusterLabels({ sigma, clusters, graph }: Props) {
    const zoomLevel = useWorkspace((s) => s.zoomLevel);
    const refs = useRef(new Map<string, HTMLDivElement>());

    const centroids = useMemo(
        () =>
            clusters
                .filter((c) => !c.outer)
                .map((c) => {
                    let x = 0;
                    let y = 0;
                    let rows = 0;
                    for (const m of c.members) {
                        const a = graph.getNodeAttributes(m);
                        x += a.x;
                        y += a.y;
                        rows += a.rows ?? 0;
                    }
                    return {
                        cluster: c,
                        x: x / c.members.length,
                        y: y / c.members.length,
                        rows,
                    };
                }),
        [clusters, graph],
    );

    useEffect(() => {
        const place = () => {
            for (const c of centroids) {
                const el = refs.current.get(c.cluster.id);
                if (!el) continue;
                const p = sigma.graphToViewport({ x: c.x, y: c.y });
                el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
            }
        };
        place();
        sigma.on('afterRender', place);
        return () => {
            sigma.removeListener('afterRender', place);
        };
    }, [sigma, centroids]);

    return (
        <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden={zoomLevel !== 'galaxy'}
        >
            {centroids.map((c) => (
                <div
                    key={c.cluster.id}
                    ref={(el) => {
                        if (el) refs.current.set(c.cluster.id, el);
                        else refs.current.delete(c.cluster.id);
                    }}
                    className="absolute top-0 left-0 rounded-md px-2 py-1 text-center transition-opacity duration-200 motion-reduce:transition-none"
                    style={{ opacity: zoomLevel === 'galaxy' ? 1 : 0 }}
                >
                    <div
                        className="text-sm font-semibold tracking-tight"
                        style={{ color: c.cluster.color }}
                    >
                        {c.cluster.label}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                        {c.cluster.members.length} tables ·{' '}
                        {new Intl.NumberFormat('en', {
                            notation: 'compact',
                        }).format(c.rows)}{' '}
                        rows
                    </div>
                </div>
            ))}
        </div>
    );
}
