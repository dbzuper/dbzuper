import { router } from '@inertiajs/react';
import { ChevronDown, Database, List } from 'lucide-react';
import { useState } from 'react';
import { safeStorage } from '@/browse/safe-storage';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { workspaceUrl } from '@/lib/connections';
import {
    databasesApi,
    readShowSystem,
    visibleDatabases,
    type DatabaseList,
} from '@/lib/databases-api';
import type { ConnectionSummary } from '@/types/connection';

/**
 * The database a server-level workspace is on, as a menu of the server's other databases. The list is fetched each
 * time the menu opens, so new databases show up without a reload.
 */
export function DatabaseSwitcher({
    connection,
}: {
    connection: ConnectionSummary;
}) {
    const [list, setList] = useState<DatabaseList | null>(null);
    const [failed, setFailed] = useState(false);
    const current = connection.database ?? '';

    const onOpenChange = (open: boolean) => {
        if (!open) return;
        setFailed(false);
        databasesApi
            .list(connection.id)
            .then(setList)
            .catch(() => setFailed(true));
    };

    const others = list
        ? visibleDatabases(list, readShowSystem(safeStorage)).filter(
              (d) => d.openable,
          )
        : [];

    return (
        <DropdownMenu onOpenChange={onOpenChange}>
            <DropdownMenuTrigger
                aria-label={`Database: ${current}. Switch database`}
                className="inline-flex max-w-56 min-w-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-sm outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
                <Database
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                />
                <span className="truncate font-mono text-[12.5px]">
                    {current}
                </span>
                <ChevronDown
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                />
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="max-h-80 w-64 overflow-y-auto"
            >
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Databases on this server
                </DropdownMenuLabel>
                {failed ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        Could not list the databases.
                    </p>
                ) : list === null ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        Loading…
                    </p>
                ) : (
                    others.map((d) => (
                        <DropdownMenuItem
                            key={d.name}
                            disabled={d.name === current}
                            onSelect={() =>
                                router.visit(
                                    workspaceUrl(connection.id, d.name),
                                )
                            }
                            className="font-mono text-[12.5px]"
                        >
                            <span className="truncate">{d.name}</span>
                        </DropdownMenuItem>
                    ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={() =>
                        router.visit(workspaceUrl(connection.id, null))
                    }
                >
                    <List className="size-3.5" aria-hidden />
                    All databases
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
