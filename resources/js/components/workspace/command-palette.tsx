import { Command } from 'cmdk';
import { useMemo, useState } from 'react';
import type { SchemaSnapshot } from '@/types/schema';
import { universe } from '@/universe/controller';
import {
    keyDisplay,
    openRecord,
    parsePaletteRecord,
} from '@/records/open-record';
import { pickPathTarget } from '@/universe/path-pick';
import { searchSchema } from '@/universe/search';
import { useWorkspace } from '@/universe/store';

const itemClass =
    'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm aria-selected:bg-muted';

export function CommandPalette({
    snapshot,
    onRefresh,
    universeAvailable = true,
}: {
    snapshot: SchemaSnapshot;
    onRefresh: () => void;
    /** False without WebGL or after a render failure: the list view is then the only view. */
    universeAvailable?: boolean;
}) {
    const open = useWorkspace((s) => s.paletteOpen);
    const setOpen = useWorkspace((s) => s.setPaletteOpen);
    const pathFrom = useWorkspace((s) => s.pathFrom);
    const [query, setQuery] = useState('');
    const results = useMemo(
        () => searchSchema(snapshot, query),
        [snapshot, query],
    );

    const record = useMemo(
        () => parsePaletteRecord(snapshot, query),
        [snapshot, query],
    );

    const close = () => {
        setOpen(false);
        setQuery('');
    };

    const pickTable = (table: string) => {
        if (!pickPathTarget(snapshot, table)) {
            useWorkspace.getState().select(table);
            universe.flyTo(table);
        }
        close();
    };

    const action = (fn: () => void) => () => {
        fn();
        close();
    };

    const st = useWorkspace.getState();
    const actions: { label: string; run: () => void }[] = [
        { label: 'Refresh schema', run: onRefresh },
        {
            label: st.showInferred
                ? 'Hide inferred relationships'
                : 'Show inferred relationships',
            run: st.toggleInferred,
        },
        { label: 'Fit everything on screen', run: universe.fitAll },
        { label: 'Re-layout the universe', run: universe.relayout },
        ...(st.view === 'list'
            ? universeAvailable
                ? [
                      {
                          label: 'Switch to universe view',
                          run: () => st.setView('universe'),
                      },
                  ]
                : []
            : [
                  {
                      label: 'Switch to list view',
                      run: () => st.setView('list'),
                  },
              ]),
        ...(st.selected
            ? [
                  {
                      label: `Focus on ${st.selected}`,
                      run: () => st.setFocus(st.selected, 1),
                  },
                  {
                      label: `Find path from ${st.selected} to…`,
                      run: () => {
                          st.startPath(st.selected!);
                          setTimeout(() => setOpen(true));
                      },
                  },
              ]
            : []),
        ...(st.focus
            ? [{ label: 'Exit focus mode', run: () => st.setFocus(null) }]
            : []),
    ];

    return (
        <Command.Dialog
            open={open}
            onOpenChange={(o) => (o ? setOpen(true) : close())}
            label="Command palette"
            shouldFilter={false}
            overlayClassName="fixed inset-0 z-40 bg-black/40"
            contentClassName="fixed top-[15%] left-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        >
            {pathFrom && (
                <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                    Find path from {pathFrom} to…
                </div>
            )}
            <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search tables, columns and actions…"
                className="w-full border-b bg-transparent px-3 py-3 text-sm outline-none"
            />
            <Command.List className="max-h-[50vh] overflow-auto p-1.5">
                <Command.Empty className="px-2 py-3 text-sm text-muted-foreground">
                    No matches.
                </Command.Empty>
                {!pathFrom && record && (
                    <Command.Group
                        heading="Records"
                        className="text-[10px] tracking-wide text-muted-foreground uppercase"
                    >
                        <Command.Item
                            value={`r:${record.table}:${keyDisplay(record.key)}`}
                            onSelect={action(() => openRecord(record))}
                            className={itemClass}
                        >
                            <span className="font-mono text-foreground normal-case">
                                Open record {record.table} ·{' '}
                                {keyDisplay(record.key)}
                            </span>
                        </Command.Item>
                    </Command.Group>
                )}
                {results.tables.length > 0 && (
                    <Command.Group
                        heading="Tables"
                        className="text-[10px] tracking-wide text-muted-foreground uppercase"
                    >
                        {results.tables.map((h) =>
                            h.kind === 'table' ? (
                                <Command.Item
                                    key={`t:${h.table}`}
                                    value={`t:${h.table}`}
                                    onSelect={() => pickTable(h.table)}
                                    className={itemClass}
                                >
                                    <span className="font-mono text-foreground normal-case">
                                        {h.table}
                                    </span>
                                    {h.tableKind === 'view' && (
                                        <span className="text-[10px] normal-case">
                                            view
                                        </span>
                                    )}
                                </Command.Item>
                            ) : null,
                        )}
                    </Command.Group>
                )}
                {!pathFrom && results.columns.length > 0 && (
                    <Command.Group
                        heading="Columns"
                        className="text-[10px] tracking-wide text-muted-foreground uppercase"
                    >
                        {results.columns.map((h) =>
                            h.kind === 'column' ? (
                                <Command.Item
                                    key={`c:${h.table}.${h.column}`}
                                    value={`c:${h.table}.${h.column}`}
                                    onSelect={() => {
                                        useWorkspace
                                            .getState()
                                            .select(h.table, 'columns');
                                        universe.flyTo(h.table);
                                        close();
                                    }}
                                    className={itemClass}
                                >
                                    <span className="font-mono text-foreground normal-case">
                                        {h.table}.{h.column}
                                    </span>
                                    <span className="ml-auto font-mono text-[11px] normal-case">
                                        {h.type}
                                    </span>
                                </Command.Item>
                            ) : null,
                        )}
                    </Command.Group>
                )}
                {!pathFrom && (
                    <Command.Group
                        heading="Actions"
                        className="text-[10px] tracking-wide text-muted-foreground uppercase"
                    >
                        {actions
                            .filter(
                                (a) =>
                                    !query ||
                                    a.label
                                        .toLowerCase()
                                        .includes(query.toLowerCase()),
                            )
                            .map((a) => (
                                <Command.Item
                                    key={a.label}
                                    value={`a:${a.label}`}
                                    onSelect={action(a.run)}
                                    className={itemClass}
                                >
                                    <span className="text-foreground normal-case">
                                        {a.label}
                                    </span>
                                </Command.Item>
                            ))}
                    </Command.Group>
                )}
            </Command.List>
        </Command.Dialog>
    );
}
