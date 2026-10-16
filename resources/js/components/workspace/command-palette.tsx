import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { useMemo, useRef, useState } from 'react';
import { useBrowse } from '@/browse/browse-store';
import { openTableTab } from '@/browse/table-actions';
import { requestFilterDraft } from '@/components/browse/data-view';
import { useSidebarPrefs } from '@/browse/sidebar-prefs';
import { INSPECTOR_HEADING_ID } from '@/components/inspector/inspector-panel';
import { takePaletteOpener } from '@/lib/workspace-shortcuts';
import { nextAppearance, useAppearance } from '@/hooks/use-appearance';
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
    connectionId,
    snapshot,
    onRefresh,
}: {
    connectionId: number;
    snapshot: SchemaSnapshot;
    onRefresh: () => void;
}) {
    const open = useWorkspace((s) => s.paletteOpen);
    const setOpen = useWorkspace((s) => s.setPaletteOpen);
    const pathFrom = useWorkspace((s) => s.pathFrom);
    const mode = useWorkspace((s) => s.paletteMode);
    const quick = mode === 'tables';
    const { appearance, updateAppearance } = useAppearance();
    const [query, setQuery] = useState('');
    const results = useMemo(
        () => searchSchema(snapshot, query),
        [snapshot, query],
    );

    const parsedRecord = useMemo(
        () => parsePaletteRecord(snapshot, query),
        [snapshot, query],
    );
    const record = quick ? null : parsedRecord;

    // Set when a pick opens the inspector: focus then lands on its heading instead of going back to
    // whatever had it before the palette (often the body).
    const focusInspector = useRef(false);

    const close = () => {
        setOpen(false);
        setQuery('');
    };

    // The inspector only lives on the Universe tab.
    const showInInspector = (table: string, tab?: 'columns') => {
        useBrowse.getState().activate(connectionId, 'universe');
        useWorkspace.getState().select(table, tab);
        universe.flyTo(table);
        focusInspector.current = true;
        close();
    };

    // Enter and click open the table tab; Shift+Enter keeps the inspector behaviour.
    const shiftRef = useRef(false);

    const pickTable = (table: string) => {
        if (pickPathTarget(snapshot, table)) close();
        else if (shiftRef.current && !quick) showInInspector(table);
        else {
            openTableTab(connectionId, table, { mode: 'permanent' });
            close();
        }
    };

    const pickColumn = (table: string, column: string) => {
        if (shiftRef.current) {
            showInInspector(table, 'columns');
            return;
        }
        // Keeps the tab's filters, sort and page; only the data view is needed for the filter draft.
        openTableTab(connectionId, table, {
            mode: 'permanent',
            state: { view: 'data' },
            merge: true,
        });
        requestFilterDraft(table, column);
        close();
    };

    const onUniverse = (fn: () => void) => () => {
        useBrowse.getState().activate(connectionId, 'universe');
        fn();
    };

    const action =
        (fn: () => void, keepOpen = false) =>
        () => {
            fn();
            if (keepOpen) setQuery('');
            else close();
        };

    const st = useWorkspace.getState();
    const actions: { label: string; run: () => void; keepOpen?: boolean }[] = [
        {
            label: 'Open table…',
            run: () => st.setPaletteOpen(true, 'tables'),
            keepOpen: true,
        },
        {
            label: 'Toggle table sidebar',
            run: () => useSidebarPrefs.getState().toggle(),
        },
        { label: 'Refresh schema', run: onRefresh },
        {
            label: st.showInferred
                ? 'Hide inferred relationships'
                : 'Show inferred relationships',
            run: st.toggleInferred,
        },
        {
            label: 'Toggle theme',
            run: () => updateAppearance(nextAppearance(appearance)),
        },
        {
            label: 'Fit everything on screen',
            run: onUniverse(universe.fitAll),
        },
        {
            label: 'Re-layout the universe',
            run: onUniverse(universe.relayout),
        },
        ...(st.selected
            ? [
                  {
                      label: `Focus on ${st.selected}`,
                      run: onUniverse(() => st.setFocus(st.selected, 1)),
                  },
                  {
                      label: `Find path from ${st.selected} to…`,
                      // The palette stays open to pick the end table.
                      keepOpen: true,
                      run: onUniverse(() => st.startPath(st.selected!)),
                  },
              ]
            : []),
        ...(st.focus
            ? [{ label: 'Exit focus mode', run: () => st.setFocus(null) }]
            : []),
    ];

    return (
        // cmdk's Command.Dialog, spelled out so the content can take onCloseAutoFocus.
        <DialogPrimitive.Root
            open={open}
            onOpenChange={(o) => (o ? setOpen(true) : close())}
        >
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay
                    cmdk-overlay=""
                    className="fixed inset-0 z-40 bg-black/40"
                />
                <DialogPrimitive.Content
                    aria-label="Command palette"
                    aria-describedby={undefined}
                    cmdk-dialog=""
                    className="fixed top-[15%] left-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
                    onCloseAutoFocus={(e) => {
                        const opener = takePaletteOpener();
                        const heading = focusInspector.current
                            ? document.getElementById(INSPECTOR_HEADING_ID)
                            : null;
                        focusInspector.current = false;
                        const target = heading ?? opener;
                        if (!target) return;
                        e.preventDefault();
                        target.focus();
                    }}
                >
                    <Command
                        label="Command palette"
                        shouldFilter={false}
                        onKeyDownCapture={(e) => {
                            if (e.key === 'Enter')
                                shiftRef.current = e.shiftKey;
                        }}
                        onClickCapture={(e) => {
                            shiftRef.current = e.shiftKey;
                        }}
                    >
                        {pathFrom && (
                            <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                                Find path from {pathFrom} to…
                            </div>
                        )}
                        <Command.Input
                            value={query}
                            onValueChange={setQuery}
                            placeholder={
                                quick
                                    ? 'Open a table…'
                                    : 'Search tables, columns and actions…'
                            }
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
                                        onSelect={action(() =>
                                            openRecord(record),
                                        )}
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
                                                onSelect={() =>
                                                    pickTable(h.table)
                                                }
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
                            {!pathFrom &&
                                !quick &&
                                results.columns.length > 0 && (
                                    <Command.Group
                                        heading="Columns"
                                        className="text-[10px] tracking-wide text-muted-foreground uppercase"
                                    >
                                        {results.columns.map((h) =>
                                            h.kind === 'column' ? (
                                                <Command.Item
                                                    key={`c:${h.table}.${h.column}`}
                                                    value={`c:${h.table}.${h.column}`}
                                                    onSelect={() =>
                                                        pickColumn(
                                                            h.table,
                                                            h.column,
                                                        )
                                                    }
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
                            {!pathFrom && !quick && (
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
                                                    .includes(
                                                        query.toLowerCase(),
                                                    ),
                                        )
                                        .map((a) => (
                                            <Command.Item
                                                key={a.label}
                                                value={`a:${a.label}`}
                                                onSelect={action(
                                                    a.run,
                                                    a.keepOpen,
                                                )}
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
                    </Command>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
