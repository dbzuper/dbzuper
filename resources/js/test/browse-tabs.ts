import { useBrowse, type TableTab } from '@/browse/browse-store';
import type { WorkspaceRef } from '@/types/connection';

/** The open tab of `table` with the given ordinal (1: the plain `orders` tab). */
export function tableTabOf(
    connectionId: WorkspaceRef,
    table: string,
    ordinal = 1,
): TableTab | undefined {
    return useBrowse
        .getState()
        .get(connectionId)
        .tabs.find(
            (t): t is TableTab =>
                t.kind === 'table' &&
                t.table === table &&
                t.ordinal === ordinal,
        );
}
