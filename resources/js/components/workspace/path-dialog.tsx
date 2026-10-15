import { Check, Copy } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useClipboard } from '@/hooks/use-clipboard';
import type { Dialect, SchemaSnapshot } from '@/types/schema';
import { buildJoinSql } from '@/universe/path';
import { useWorkspace } from '@/universe/store';

export function PathDialog({ snapshot }: { snapshot: SchemaSnapshot }) {
    const pathFrom = useWorkspace((s) => s.pathFrom);
    const pathTo = useWorkspace((s) => s.pathTo);
    const path = useWorkspace((s) => s.path);
    const showInferred = useWorkspace((s) => s.showInferred);
    const clearPath = useWorkspace((s) => s.clearPath);
    const [copiedText, copy] = useClipboard();
    const open = path !== null;
    const sql = useMemo(
        () =>
            path && path.length > 1
                ? buildJoinSql(
                      snapshot,
                      path,
                      snapshot.driver as Dialect,
                      showInferred,
                  )
                : '',
        [snapshot, path, showInferred],
    );
    const copied = sql !== '' && copiedText === sql;

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => !o && clearPath()}
            modal={false}
        >
            <DialogContent className="top-auto right-4 bottom-4 left-auto max-w-lg translate-x-0 translate-y-0">
                <DialogHeader>
                    <DialogTitle>Path finder</DialogTitle>
                    <DialogDescription>
                        {path && path.length > 1
                            ? path.join(' → ')
                            : `No relationship path connects ${pathFrom} and ${pathTo}.`}
                    </DialogDescription>
                </DialogHeader>
                {sql && (
                    <>
                        <pre
                            data-testid="join-sql"
                            className="overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre"
                        >
                            {sql}
                        </pre>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                                Opening this in the SQL editor arrives with the
                                SQL workspace.
                            </span>
                            <Button
                                size="sm"
                                className="ml-auto"
                                onClick={() => void copy(sql)}
                            >
                                {copied ? (
                                    <Check className="size-3.5" />
                                ) : (
                                    <Copy className="size-3.5" />
                                )}{' '}
                                Copy SQL
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
