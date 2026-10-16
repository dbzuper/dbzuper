import type { RelationshipSchema, SchemaSnapshot } from '@/types/schema';
import { universe } from '@/universe/controller';
import { useWorkspace } from '@/universe/store';

function Row({
    rel,
    other,
    mine,
    theirs,
    onOpenTable,
}: {
    rel: RelationshipSchema;
    other: string;
    mine: string[];
    theirs: string[];
    onOpenTable?: (table: string) => void;
}) {
    const select = useWorkspace((s) => s.select);
    return (
        <li className="flex items-center gap-2 px-4 py-2 text-xs">
            <span className="font-mono">{mine.join(', ')}</span>
            <span className="text-muted-foreground">→</span>
            <button
                type="button"
                className="font-mono font-medium hover:underline"
                onClick={() => {
                    if (onOpenTable) {
                        onOpenTable(other);
                        return;
                    }
                    select(other);
                    universe.flyTo(other);
                }}
            >
                {other}
            </button>
            <span className="font-mono text-muted-foreground">
                ({theirs.join(', ')})
            </span>
            <span className="ml-auto rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {rel.inferred
                    ? `${Math.round(rel.confidence * 100)}% inferred`
                    : 'foreign key'}
            </span>
        </li>
    );
}

export function RelationshipsTab({
    snapshot,
    table,
    onOpenTable,
}: {
    snapshot: SchemaSnapshot;
    table: string;
    /** Opens the related table instead of selecting it in the Universe. */
    onOpenTable?: (table: string) => void;
}) {
    const outgoing = snapshot.relationships.filter(
        (r) => r.from_table === table,
    );
    const incoming = snapshot.relationships.filter(
        (r) => r.to_table === table && r.from_table !== table,
    );
    const section = (title: string, rows: React.ReactNode[]) => (
        <section>
            <h3 className="px-4 pt-3 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {title} · {rows.length}
            </h3>
            {rows.length === 0 ? (
                <p className="px-4 py-2 text-xs text-muted-foreground">None</p>
            ) : (
                <ul className="divide-y divide-border">{rows}</ul>
            )}
        </section>
    );
    return (
        <div>
            {section(
                'References',
                outgoing.map((r) => (
                    <Row
                        key={r.id}
                        rel={r}
                        other={r.to_table}
                        mine={r.from_columns}
                        theirs={r.to_columns}
                        onOpenTable={onOpenTable}
                    />
                )),
            )}
            {section(
                'Referenced by',
                incoming.map((r) => (
                    <Row
                        key={r.id}
                        rel={r}
                        other={r.from_table}
                        mine={r.to_columns}
                        theirs={r.from_columns}
                        onOpenTable={onOpenTable}
                    />
                )),
            )}
        </div>
    );
}
