import { toast } from 'sonner';
import type { SchemaSnapshot } from '@/types/schema';
import { findPath } from './path';
import { useWorkspace } from './store';

/**
 * Uses `table` as the end of a pending path, from a canvas click or a palette pick.
 * Picking the start table again cancels the pick. Returns false when no path start is pending.
 */
export function pickPathTarget(
    snapshot: SchemaSnapshot,
    table: string,
): boolean {
    const st = useWorkspace.getState();
    if (!st.pathFrom) return false;
    if (st.pathFrom === table) {
        st.clearPath();
        toast('Pick a different table to find a path.');
        return true;
    }
    st.completePath(
        table,
        findPath(snapshot, st.pathFrom, table, st.showInferred),
    );
    return true;
}
