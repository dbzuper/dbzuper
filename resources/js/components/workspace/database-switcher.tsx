import { router } from '@inertiajs/react';
import { ChevronDown, Database, List, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const search = useRef<HTMLInputElement>(null);
    const current = connection.database ?? '';

    // The menu focuses itself when it opens; typing should go to the search box instead.
    useEffect(() => {
        if (!open) return;
        const frame = requestAnimationFrame(() => search.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [open]);

    const onOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) return;
        setQuery('');
        setFailed(false);
        databasesApi
            .list(connection.id)
            .then(setList)
            .catch(() => setFailed(true));
    };

    const others = list
        ? visibleDatabases(list, readShowSystem(safeStorage), query).filter(
              (d) => d.openable,
          )
        : [];
    const visit = (name: string | null) =>
        router.visit(workspaceUrl(connection.id, name));

    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
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
                <label className="sticky top-0 z-10 mx-1 mb-1 flex h-8 items-center gap-2 rounded-md border bg-popover px-2 text-muted-foreground focus-within:border-ring">
                    <Search className="size-3.5 shrink-0" aria-hidden />
                    <input
                        ref={search}
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                const first = others.find(
                                    (d) => d.name !== current,
                                );
                                if (first) {
                                    setOpen(false);
                                    visit(first.name);
                                }
                                return;
                            }
                            // Arrows move into the list and Escape closes it; every other key is typing, which the
                            // menu would otherwise take for its type-to-select.
                            if (
                                ![
                                    'ArrowDown',
                                    'ArrowUp',
                                    'Escape',
                                    'Tab',
                                ].includes(e.key)
                            )
                                e.stopPropagation();
                        }}
                        placeholder="Find a database"
                        aria-label="Find a database"
                        className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
                    />
                </label>
                {failed ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        Could not list the databases.
                    </p>
                ) : list === null ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        Loading…
                    </p>
                ) : others.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        {query.trim()
                            ? `No database matches "${query.trim()}"`
                            : 'No other databases.'}
                    </p>
                ) : (
                    others.map((d) => (
                        <DropdownMenuItem
                            key={d.name}
                            disabled={d.name === current}
                            onSelect={() => visit(d.name)}
                            className="font-mono text-[12.5px]"
                        >
                            <span className="truncate">{d.name}</span>
                        </DropdownMenuItem>
                    ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => visit(null)}>
                    <List className="size-3.5" aria-hidden />
                    All databases
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
