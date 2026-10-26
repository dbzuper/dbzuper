import type { ReactNode } from 'react';
import type { OpenMode } from '@/browse/browse-store';
import { usePins } from '@/browse/pins-store';
import { openTableInNewTab } from '@/browse/table-actions';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { writeClipboard } from '@/grid/copy';
import type { WorkspaceRef } from '@/types/connection';

export type TableActions = {
    open: (table: string, mode: OpenMode) => void;
    structure: (table: string) => void;
    openInSql: (table: string) => void;
    showInUniverse: (table: string) => void;
};

export function TableContextMenu({
    connectionId,
    table,
    actions,
    children,
}: {
    connectionId: WorkspaceRef;
    table: string;
    actions: TableActions;
    children: ReactNode;
}) {
    const pinned = usePins((s) =>
        s.byConnection[connectionId]?.some((p) => p.table === table),
    );
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem
                    onSelect={() => actions.open(table, 'permanent')}
                >
                    Open
                </ContextMenuItem>
                <ContextMenuItem
                    onSelect={() => openTableInNewTab(connectionId, table)}
                >
                    Open in new tab
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => actions.structure(table)}>
                    Structure
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => actions.openInSql(table)}>
                    Open in SQL
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => actions.showInUniverse(table)}>
                    Show in Universe
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                    onSelect={() =>
                        void usePins.getState().toggle(connectionId, table)
                    }
                >
                    {pinned ? 'Unpin' : 'Pin'}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void writeClipboard(table)}>
                    Copy name
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
