import { toast } from "sonner";
import { pendingKey, usePending } from "./pending-store";
import { useReview } from "./review-store";

/**
 * Fits the connection's staged changes to a refreshed schema (spec §4.4) and says what was dropped. A table whose
 * commit is on its way is left alone until the commit ends: rebuilding its changes then would keep committed ones
 * pending (settle matches what was committed), so they could be committed twice.
 */
export function reconcilePending(
    connectionId: number,
    tables: Map<string, string[]>,
    only?: string,
): void {
    const review = useReview.getState();
    const busy = (table: string) =>
        !!review.committing[pendingKey(connectionId, table)];
    const dropped = usePending
        .getState()
        .reconcile(
            connectionId,
            tables,
            (t) => (only === undefined || t === only) && !busy(t),
        );
    const prefix = `${connectionId}:`;
    for (const key of Object.keys(review.committing)) {
        if (!key.startsWith(prefix)) continue;
        const table = key.slice(prefix.length);
        if (only === undefined || table === only)
            review.afterCommit(key, () =>
                reconcilePending(connectionId, tables, table),
            );
    }
    for (const d of dropped)
        toast(
            d.reason === "table"
                ? `Pending changes to ${d.table} were dropped: the table no longer exists.`
                : `Pending changes to removed columns of ${d.table} were dropped.`,
        );
}
