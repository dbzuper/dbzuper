import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { pendingCounts, pendingKey, usePending } from "@/editing/pending-store";
import { useReview } from "@/editing/review-store";
import { DiscardDialog } from "./discard-dialog";

/**
 * Above the pager while the table has pending changes (spec §4.1): the counts, Discard (asks first) and Review &
 * commit. Pending changes belong to the table, so every view of it shows the same bar.
 */
export function PendingBar({
    connectionId,
    table,
}: {
    connectionId: number;
    table: string;
}) {
    const rows = usePending((s) => s.byTable[pendingKey(connectionId, table)]);
    const counts = useMemo(() => (rows ? pendingCounts(rows) : null), [rows]);
    const [asking, setAsking] = useState(false);
    const total = counts
        ? counts.inserted + counts.updated + counts.deleted
        : 0;
    if (!counts || total === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-2 border-t bg-warning/10 px-3 py-1 text-xs">
            <span role="status" className="font-medium text-warning-foreground">
                {`${total} pending change${total === 1 ? "" : "s"} · ${counts.inserted} new · ${counts.updated} edited · ${counts.deleted} deleted`}
            </span>
            <div className="ml-auto flex items-center gap-1">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setAsking(true)}
                >
                    Discard
                </Button>
                <Button
                    type="button"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    aria-keyshortcuts="Control+S Meta+S"
                    onClick={() =>
                        useReview.getState().openReview(connectionId, table)
                    }
                >
                    Review &amp; commit…
                </Button>
            </div>
            <DiscardDialog
                targets={asking ? [{ table, count: total }] : null}
                onCancel={() => setAsking(false)}
                onConfirm={() => {
                    setAsking(false);
                    usePending.getState().discard(connectionId, table);
                }}
            />
        </div>
    );
}
