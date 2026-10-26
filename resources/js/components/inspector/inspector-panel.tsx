import { Crosshair, Route, Table2, X } from 'lucide-react';
import { useMemo } from 'react';
import { openTableTab } from '@/browse/table-actions';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isOverNineThousand, POWER_LEVEL_LINE } from '@/lib/easter-eggs';
import { formatBytes, formatRowCount } from '@/lib/format';
import type { SchemaSnapshot, TableSchema } from '@/types/schema';
import { useWorkspace, type InspectorTab } from '@/universe/store';
import { fkColumnsByTable } from '@/universe/visible';
import { ColumnsTab } from './columns-tab';
import { DdlTab } from './ddl-tab';
import { IndexesTab } from './indexes-tab';
import { RelationshipsTab } from './relationships-tab';
import type { WorkspaceRef } from '@/types/connection';

/** The inspector's heading: the command palette moves focus here after picking a table. */
export const INSPECTOR_HEADING_ID = 'inspector-heading';

type Props = {
    connectionId: WorkspaceRef;
    snapshot: SchemaSnapshot;
    table: TableSchema;
};

export function InspectorPanel({ connectionId, snapshot, table }: Props) {
    const tab = useWorkspace((s) => s.inspectorTab);
    const setTab = useWorkspace((s) => s.setInspectorTab);
    const select = useWorkspace((s) => s.select);
    const setFocus = useWorkspace((s) => s.setFocus);
    const startPath = useWorkspace((s) => s.startPath);
    const fk = useMemo(
        () =>
            fkColumnsByTable(snapshot).get(table.name) ?? {
                declared: new Set<string>(),
                inferred: new Set<string>(),
            },
        [snapshot, table.name],
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start gap-2 border-b px-4 py-3">
                <div className="min-w-0">
                    <h2
                        id={INSPECTOR_HEADING_ID}
                        tabIndex={-1}
                        className="truncate rounded-sm font-mono text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        {table.name}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {table.kind} ·{' '}
                        <span
                            title={
                                isOverNineThousand(table.row_count)
                                    ? POWER_LEVEL_LINE
                                    : undefined
                            }
                        >
                            {formatRowCount(table.row_count)} rows
                        </span>{' '}
                        · {table.columns.length} columns ·{' '}
                        {formatBytes(table.size_bytes)}
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7"
                    aria-label="Close inspector"
                    onClick={() => select(null)}
                >
                    <X className="size-4" />
                </Button>
            </div>
            <div className="flex gap-1.5 border-b px-4 py-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFocus(table.name, 1)}
                >
                    <Crosshair className="size-3.5" /> Focus
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startPath(table.name)}
                >
                    <Route className="size-3.5" /> Find path to…
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                        openTableTab(connectionId, table.name, {
                            mode: 'permanent',
                        })
                    }
                >
                    <Table2 className="size-3.5" /> Open data
                </Button>
            </div>
            <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as InspectorTab)}
                className="min-h-0 flex-1"
            >
                <TabsList>
                    <TabsTrigger value="columns">Columns</TabsTrigger>
                    <TabsTrigger value="relationships">
                        Relationships
                    </TabsTrigger>
                    <TabsTrigger value="indexes">Indexes</TabsTrigger>
                    <TabsTrigger value="ddl">DDL</TabsTrigger>
                </TabsList>
                <TabsContent value="columns">
                    <ColumnsTab table={table} fk={fk} />
                </TabsContent>
                <TabsContent value="relationships">
                    <RelationshipsTab snapshot={snapshot} table={table.name} />
                </TabsContent>
                <TabsContent value="indexes">
                    <IndexesTab table={table} />
                </TabsContent>
                <TabsContent value="ddl">
                    <DdlTab
                        connectionId={connectionId}
                        snapshot={snapshot}
                        table={table}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
