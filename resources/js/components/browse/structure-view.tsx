import { useMemo, type ReactNode } from 'react';
import { ColumnsTab } from '@/components/inspector/columns-tab';
import { DdlTab } from '@/components/inspector/ddl-tab';
import { IndexesTab } from '@/components/inspector/indexes-tab';
import { RelationshipsTab } from '@/components/inspector/relationships-tab';
import type { SchemaSnapshot, TableSchema } from '@/types/schema';
import { fkColumnsByTable } from '@/universe/visible';

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="border-b last:border-b-0">
            <h3 className="px-4 pt-4 pb-2 text-xs font-semibold">{title}</h3>
            {children}
        </section>
    );
}

export function StructureView({
    connectionId,
    snapshot,
    table,
    onOpenTable,
}: {
    connectionId: number;
    snapshot: SchemaSnapshot;
    table: TableSchema;
    onOpenTable: (name: string) => void;
}) {
    const fk = useMemo(
        () =>
            fkColumnsByTable(snapshot).get(table.name) ?? {
                declared: new Set<string>(),
                inferred: new Set<string>(),
            },
        [snapshot, table.name],
    );
    return (
        <div className="h-full min-h-0 overflow-auto">
            <Section title="Columns">
                <ColumnsTab table={table} fk={fk} />
            </Section>
            <Section title="Indexes">
                <IndexesTab table={table} />
            </Section>
            <Section title="Relationships">
                <RelationshipsTab
                    snapshot={snapshot}
                    table={table.name}
                    onOpenTable={onOpenTable}
                />
            </Section>
            <Section title="DDL">
                <DdlTab
                    connectionId={connectionId}
                    snapshot={snapshot}
                    table={table}
                />
            </Section>
        </div>
    );
}
