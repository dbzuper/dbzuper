import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { cellKind, cellText, type CellValue } from '@/grid/cells';
import { writeClipboard } from '@/grid/copy';
import type { QueryCell, QueryColumn } from '@/types/schema';

/** The server cuts long text at this many characters and appends an ellipsis. */
export const TRUNCATION_LIMIT = 4000;

export type DrawerState = { column: QueryColumn; value: QueryCell } | null;

function display(value: CellValue, type: string | null): string {
    if (value === null) return 'NULL';
    const raw = cellText(value);
    if (cellKind(value, type) === 'json') {
        try {
            return JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
            return raw;
        }
    }
    return raw;
}

export function CellDrawer({
    state,
    onClose,
}: {
    state: DrawerState;
    onClose: () => void;
}) {
    const shown = state ? display(state.value, state.column.type) : '';
    const truncated =
        state !== null &&
        typeof state.value === 'string' &&
        Array.from(state.value).length === TRUNCATION_LIMIT + 1 &&
        state.value.endsWith('…');

    const copy = async () => {
        if (await writeClipboard(shown)) toast.success('Copied value.');
        else toast.error('Could not copy: the clipboard is unavailable.');
    };

    return (
        <Sheet open={state !== null} onOpenChange={(o) => !o && onClose()}>
            <SheetContent className="sm:max-w-lg">
                <SheetHeader>
                    <SheetTitle>Cell value</SheetTitle>
                    <SheetDescription>
                        {state?.column.name}
                        {state?.column.type ? ` · ${state.column.type}` : ''}
                    </SheetDescription>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4">
                    <pre className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs break-words whitespace-pre-wrap">
                        {shown}
                    </pre>
                    {truncated && (
                        <p className="text-xs text-muted-foreground">
                            Value truncated at 4,000 characters
                        </p>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => void copy()}
                    >
                        Copy
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
