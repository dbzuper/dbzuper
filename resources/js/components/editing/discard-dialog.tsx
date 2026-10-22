import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export type DiscardTarget = { table: string; count: number };

/** "Discard N pending changes to `orders`?" for one table, or the list for several. */
export function discardQuestion(targets: DiscardTarget[]): string {
    const n = targets.reduce((sum, t) => sum + t.count, 0);
    const changes = `${n} pending change${n === 1 ? "" : "s"}`;
    const names = targets.map((t) => `\`${t.table}\``).join(", ");
    return `Discard ${changes} to ${names}?`;
}

/** Asks before staged changes are thrown away (Discard, or closing the last view of their table). */
export function DiscardDialog({
    targets,
    onConfirm,
    onCancel,
}: {
    /** Open while non-null. */
    targets: DiscardTarget[] | null;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <Dialog
            open={targets !== null}
            onOpenChange={(open) => {
                if (!open) onCancel();
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {targets ? discardQuestion(targets) : ""}
                    </DialogTitle>
                    <DialogDescription>
                        Nothing has been written to the database yet; the staged
                        changes will be lost.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Keep changes
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={onConfirm}
                    >
                        Discard
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
