import type { TableActions } from '@/components/browse/table-context-menu';
import { quoteIdent } from '@/grid/copy';
import { useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionSummary } from '@/types/connection';
import type { SchemaSnapshot } from '@/types/schema';
import { universe } from '@/universe/controller';
import { useWorkspace } from '@/universe/store';
import { openTableTabInSql } from './sql-link';
import {
    latestTableTab,
    useBrowse,
    type OpenMode,
    type TableTabState,
} from './browse-store';

/** Opens (or focuses) a table tab; the history panel closes so the tab is not hidden behind it. */
export function openTableTab(
    connectionId: number,
    table: string,
    opts?: {
        mode?: OpenMode;
        state?: Partial<TableTabState>;
        merge?: boolean;
    },
): void {
    useBrowse.getState().openTable(connectionId, table, opts);
    useWorkspace.getState().setHistoryOpen(false);
}

/**
 * "Open in new tab": a further view of the table with default state when it is already open, else a
 * background tab as before.
 */
export function openTableInNewTab(connectionId: number, table: string): void {
    if (latestTableTab(connectionId, table)) {
        useBrowse.getState().openNewView(connectionId, table);
        useWorkspace.getState().setHistoryOpen(false);
    } else openTableTab(connectionId, table, { mode: 'background' });
}

/**
 * Opens a table filtered on `column = value` pairs (FK links from records and SQL results): the latest tab
 * of the table gets these filters in place of its own, else a new tab opens.
 */
export function openTableFiltered(
    connectionId: number,
    table: string,
    pairs: { column: string; value: string }[],
): void {
    openTableTab(connectionId, table, {
        mode: 'permanent',
        state: {
            filters: pairs.map((p) => ({
                column: p.column,
                op: 'eq',
                value: p.value,
            })),
        },
    });
}

/** Activates the Universe tab and selects (and flies to) a table there. */
export function showInUniverse(connectionId: number, table: string): void {
    useBrowse.getState().activate(connectionId, 'universe');
    useWorkspace.getState().select(table);
    universe.flyTo(table);
}

/**
 * The table actions shared by the sidebar, the tab bar and the table tab. The snapshot is part of the
 * signature so callers rebuild the actions when the schema changes.
 */
export function makeTableActions(
    connection: ConnectionSummary,
    _snapshot: SchemaSnapshot,
): TableActions {
    const c = connection.id;
    return {
        open: (table, mode) => openTableTab(c, table, { mode }),
        structure: (table) =>
            openTableTab(c, table, {
                mode: 'permanent',
                state: { view: 'structure' },
                merge: true,
            }),
        // On an open table, the editor tab linked to its latest tab; else an unlinked first-page SELECT.
        openInSql: (table) => {
            const latest = latestTableTab(c, table);
            if (latest) openTableTabInSql(c, latest, connection.driver);
            else
                useSqlTabs
                    .getState()
                    .openTab(
                        c,
                        `SELECT * FROM ${quoteIdent(connection.driver, table)} LIMIT 100`,
                        table,
                    );
            useWorkspace.getState().setDockOpen(true);
        },
        showInUniverse: (table) => showInUniverse(c, table),
    };
}
