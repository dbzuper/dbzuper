import { ListTree, Loader2, Play, PlayCircle, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

export const ROW_LIMITS = [100, 1000, 5000, 10000] as const;
export const DEFAULT_ROW_LIMIT = 1000;

export function SqlToolbar({
    running,
    maxRows,
    onMaxRows,
    onRun,
    onRunAll,
    onExplain,
    onCancel,
}: {
    running: boolean;
    maxRows: number;
    onMaxRows: (n: number) => void;
    onRun: () => void;
    onRunAll: () => void;
    onExplain: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="flex items-center gap-1.5 border-b px-2 py-1">
            <Button
                size="sm"
                className="h-7 gap-1"
                title="Run statement (Ctrl/⌘+Enter)"
                disabled={running}
                onClick={onRun}
            >
                <Play className="size-3.5" />
                Run
            </Button>
            <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1"
                title="Run all (Ctrl/⌘+Shift+Enter)"
                disabled={running}
                onClick={onRunAll}
            >
                <PlayCircle className="size-3.5" />
                Run all
            </Button>
            <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1"
                title="Explain the current statement"
                disabled={running}
                onClick={onExplain}
            >
                <ListTree className="size-3.5" />
                Explain
            </Button>
            {running && (
                <>
                    <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 gap-1"
                        title="Stops waiting — the server may still finish the statement"
                        onClick={onCancel}
                    >
                        <Square className="size-3.5" />
                        Cancel
                    </Button>
                    <span
                        role="status"
                        className="flex items-center gap-1 text-xs text-muted-foreground"
                    >
                        <Loader2 className="size-3.5 animate-spin" />
                        Running…
                    </span>
                </>
            )}
            <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <span id="row-limit-label">Row limit</span>
                <Select
                    value={String(maxRows)}
                    onValueChange={(v) => onMaxRows(Number(v))}
                >
                    <SelectTrigger
                        size="sm"
                        className="h-7 w-24"
                        aria-labelledby="row-limit-label"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ROW_LIMITS.map((n) => (
                            <SelectItem key={n} value={String(n)}>
                                {n.toLocaleString('en-US')}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
