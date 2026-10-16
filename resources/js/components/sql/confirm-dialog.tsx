import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConfirmAnswer } from '@/sql/run-query';
import type { ConfirmationPayload } from '@/types/schema';

export type ConfirmRequest = { confirmation: ConfirmationPayload; sql: string };

/** What a statement of each kind does; transaction statements never need confirming. */
function effectOf(kind: string): string {
    switch (kind) {
        case 'session':
            return 'changes session settings for this run';
        case 'ddl':
            return 'changes the schema on this connection';
        case 'destructive':
            return 'removes data or objects on this connection and cannot be undone';
        default:
            return 'changes data on this connection';
    }
}

export function ConfirmDialog({
    request,
    onResolve,
}: {
    request: ConfirmRequest | null;
    onResolve: (a: ConfirmAnswer) => void;
}) {
    return (
        <Dialog
            open={request !== null}
            onOpenChange={(open) => {
                if (!open) onResolve(null);
            }}
        >
            <DialogContent>
                {request && (
                    <ConfirmBody request={request} onResolve={onResolve} />
                )}
            </DialogContent>
        </Dialog>
    );
}

function ConfirmBody({
    request,
    onResolve,
}: {
    request: ConfirmRequest;
    onResolve: (a: ConfirmAnswer) => void;
}) {
    const { confirmation: c, sql } = request;
    const [typed, setTyped] = useState('');
    const isTyped = c.mode === 'typed';
    const target = c.target ?? c.keyword;
    const ready = !isTyped || typed === target;

    return (
        <form
            className="grid gap-4"
            onSubmit={(e) => {
                e.preventDefault();
                if (ready)
                    onResolve(
                        isTyped
                            ? { confirmed: true, typed }
                            : { confirmed: true },
                    );
            }}
        >
            <DialogHeader>
                <DialogTitle>
                    {isTyped
                        ? 'Confirm destructive statement'
                        : 'Confirm statement'}
                </DialogTitle>
                <DialogDescription>
                    {`${c.keyword} ${effectOf(c.kind)}.`}
                </DialogDescription>
            </DialogHeader>
            <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
                {sql}
            </pre>
            {isTyped && (
                <div className="grid gap-1.5">
                    <Label htmlFor="confirm-typed">
                        Type {target} to confirm
                    </Label>
                    {target.includes(', ') && (
                        <p className="text-xs text-muted-foreground">
                            This statement names several objects: type them
                            exactly as listed, separated by a comma and a space.
                        </p>
                    )}
                    <Input
                        id="confirm-typed"
                        autoComplete="off"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                    />
                </div>
            )}
            <DialogFooter>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => onResolve(null)}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant={isTyped ? 'destructive' : 'default'}
                    disabled={!ready}
                >
                    Run {c.keyword}
                </Button>
            </DialogFooter>
        </form>
    );
}
