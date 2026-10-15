import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useClipboard } from '@/hooks/use-clipboard';
import { dbErrorFrom, workspaceApi } from '@/lib/workspace-api';
import type { Dialect, SchemaSnapshot, TableSchema } from '@/types/schema';
import { generateDdl } from '@/universe/ddl';

export function DdlTab({
    connectionId,
    snapshot,
    table,
}: {
    connectionId: number;
    snapshot: SchemaSnapshot;
    table: TableSchema;
}) {
    const [ddl, setDdl] = useState<{ text: string; native: boolean } | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);
    const [copiedText, copy] = useClipboard();

    useEffect(() => {
        let cancelled = false;
        setDdl(null);
        setError(null);
        workspaceApi
            .ddl(connectionId, table.name)
            .then((r) => {
                if (cancelled) return;
                setDdl(
                    r.ddl
                        ? { text: r.ddl, native: true }
                        : {
                              text: generateDdl(
                                  table,
                                  snapshot.relationships,
                                  snapshot.driver as Dialect,
                              ),
                              native: false,
                          },
                );
            })
            .catch(
                (e) =>
                    !cancelled &&
                    setError(dbErrorFrom(e, 'Could not load DDL.').message),
            );
        return () => {
            cancelled = true;
        };
    }, [connectionId, table, snapshot]);

    if (error)
        return (
            <p role="alert" className="px-4 py-3 text-xs text-destructive">
                {error}
            </p>
        );
    if (!ddl)
        return (
            <p className="px-4 py-3 text-xs text-muted-foreground">
                Loading DDL…
            </p>
        );

    const copied = copiedText === ddl.text;

    return (
        <div className="flex flex-col gap-2 p-3">
            <div className="flex items-center gap-2">
                {!ddl.native && (
                    <span className="text-[11px] text-muted-foreground">
                        Approximate DDL generated from the schema snapshot
                    </span>
                )}
                <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => void copy(ddl.text)}
                >
                    {copied ? (
                        <Check className="size-3.5" />
                    ) : (
                        <Copy className="size-3.5" />
                    )}{' '}
                    Copy
                </Button>
            </div>
            <pre
                data-testid="ddl"
                className="overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre"
            >
                {ddl.text}
            </pre>
        </div>
    );
}
