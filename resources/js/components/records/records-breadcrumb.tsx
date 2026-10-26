import { Fragment, useMemo } from 'react';
import { recordTitle } from '@/records/heuristics';
import { useRecords, type RecordEntry } from '@/records/records-store';
import { emptyTrail, pathTo, type TrailNode } from '@/records/trail';
import { buildTrailSql } from '@/records/trail-sql';
import { useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionSummary } from '@/types/connection';
import type { Dialect, SchemaSnapshot } from '@/types/schema';
import { useWorkspace } from '@/universe/store';

const NO_SQL_TITLE =
    'This path cannot be written as SQL: a relationship on it is no longer in the schema.';

const NO_SELECTION_TITLE = 'Select a record to copy its path';
const DIALECTS: Dialect[] = ['mysql', 'mariadb', 'pgsql', 'sqlite'];

const button =
    'rounded border px-2 py-0.5 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent';

function crumbLabel(node: TrailNode, entry: RecordEntry | undefined): string {
    const source = entry?.payload
        ? {
              columns: entry.payload.columns,
              values: entry.payload.values,
              primaryKey: Object.keys(node.key),
          }
        : entry?.preview;
    const title = source
        ? recordTitle(source.columns, source.values, source.primaryKey)
        : Object.values(node.key).join(' · ');
    return `${node.table} · ${title}`;
}

export function RecordsBreadcrumb({
    connection,
    snapshot,
}: {
    connection: ConnectionSummary;
    snapshot: SchemaSnapshot;
}) {
    const trail = useRecords((s) => s.trail);
    const records = useRecords((s) => s.records);
    const target = trail.selected ?? trail.nodes[0]?.id ?? null;
    const path = useMemo(
        () => (target ? pathTo(trail, target) : null),
        [trail, target],
    );
    const dialect = DIALECTS.find((d) => d === snapshot.driver) ?? null;
    const sql = useMemo(
        () =>
            trail.selected && dialect
                ? buildTrailSql(trail, trail.selected, snapshot, dialect)
                : null,
        [trail, snapshot, dialect],
    );
    const whyNot = !trail.selected
        ? NO_SELECTION_TITLE
        : !dialect
          ? `SQL for the ${snapshot.driver} engine is not supported.`
          : NO_SQL_TITLE;
    if (trail.nodes.length === 0) return null;

    const copy = () => {
        if (sql === null) return;
        useSqlTabs.getState().openTab(connection.ref, sql, 'Record path');
        useWorkspace.getState().setDockOpen(true);
        // Best effort: the tab is the source of truth, a refused clipboard is not an error.
        try {
            navigator.clipboard?.writeText(sql)?.catch(() => undefined);
        } catch {
            // Clipboard unavailable.
        }
    };

    return (
        <div className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-1.5">
            <nav
                aria-label="Record path"
                className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs"
            >
                {(path?.nodes ?? []).map((node, i) => (
                    <Fragment key={node.id}>
                        {i > 0 && (
                            <span aria-hidden className="text-muted-foreground">
                                ›
                            </span>
                        )}
                        <button
                            type="button"
                            data-crumb
                            aria-current={
                                node.id === trail.selected
                                    ? 'location'
                                    : undefined
                            }
                            onClick={() =>
                                useRecords.getState().select(node.id)
                            }
                            className={`max-w-56 shrink-0 truncate rounded px-1.5 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none ${
                                node.id === trail.selected
                                    ? 'font-semibold'
                                    : ''
                            }`}
                        >
                            {crumbLabel(node, records[node.id])}
                        </button>
                    </Fragment>
                ))}
            </nav>
            <button
                type="button"
                aria-label="Copy path as SQL"
                title={sql === null ? whyNot : 'Open this path as SQL'}
                disabled={sql === null}
                onClick={copy}
                className={button}
            >
                Copy path as SQL
            </button>
            <button
                type="button"
                aria-label="Close explorer"
                onClick={() => useRecords.getState().setTrail(emptyTrail())}
                className={button}
            >
                Close explorer
            </button>
        </div>
    );
}
