import { Head, Link } from '@inertiajs/react';
import { LayoutGrid, List, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { safeStorage } from '@/browse/safe-storage';
import { ConnectionCard } from '@/components/connections/connection-card';
import { ConnectionRow } from '@/components/connections/connection-row';
import { ConnectionsEmpty } from '@/components/connections/connections-empty';
import { ConnectionsHero } from '@/components/connections/connections-hero';
import { NewConnectionCard } from '@/components/connections/new-connection-card';
import { Button } from '@/components/ui/button';
import { formatConnectionTarget } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionCard as Card } from '@/types/connection';

type View = 'cards' | 'list';

const VIEW_KEY = 'dbzuper.connections-view';

/** True when a keystroke there would type text, so a page shortcut must leave it alone. */
function isTyping(el: Element | null) {
    return (
        el instanceof HTMLElement &&
        (el.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
            !!el.closest('[role="menu"], [role="dialog"]'))
    );
}

export default function ConnectionsIndex({
    connections,
    canTryDemo = false,
}: {
    connections: Card[];
    /** An allowed SQLite directory exists, so "Try it with demo data" can build the demo there. */
    canTryDemo?: boolean;
}) {
    // Drafts of connections that were removed (here or elsewhere) would otherwise stay in localStorage forever.
    useEffect(() => {
        useSqlTabs.getState().prune(connections.map((c) => c.id));
    }, [connections]);

    const [query, setQuery] = useState('');
    const [view, setView] = useState<View>(() =>
        safeStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards',
    );
    const search = useRef<HTMLInputElement>(null);

    const choose = (v: View) => {
        setView(v);
        safeStorage.setItem(VIEW_KEY, v);
    };

    // "/" focuses search, unless the user is typing somewhere else.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (
                e.key !== '/' ||
                e.defaultPrevented ||
                e.ctrlKey ||
                e.metaKey ||
                e.altKey ||
                isTyping(document.activeElement)
            )
                return;
            e.preventDefault();
            search.current?.focus();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    const q = query.trim().toLowerCase();
    const shown = useMemo(
        () =>
            q
                ? connections.filter((c) =>
                      [c.name, c.driver_label, formatConnectionTarget(c)].some(
                          (s) => s.toLowerCase().includes(q),
                      ),
                  )
                : connections,
        [connections, q],
    );

    return (
        <>
            <Head title="Connections" />
            <div className="flex min-h-full flex-col">
                <ConnectionsHero connections={connections}>
                    {connections.length > 0 && (
                        <div className="mt-[22px] flex flex-wrap items-center gap-2.5">
                            <label className="flex h-9 max-w-[420px] min-w-48 flex-1 items-center gap-2 rounded-[10px] border bg-background px-3 text-muted-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                                <Search
                                    className="size-4 shrink-0"
                                    aria-hidden
                                />
                                <input
                                    ref={search}
                                    type="search"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') setQuery('');
                                    }}
                                    placeholder="Find a connection"
                                    aria-label="Find a connection"
                                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
                                />
                                <kbd className="rounded-[5px] border px-1.5 font-mono text-[11px]">
                                    /
                                </kbd>
                            </label>
                            <div
                                role="group"
                                aria-label="View"
                                className="inline-flex rounded-[9px] bg-muted p-[3px]"
                            >
                                {(
                                    [
                                        ['cards', 'Card view', LayoutGrid],
                                        ['list', 'List view', List],
                                    ] as const
                                ).map(([v, label, Icon]) => (
                                    <button
                                        key={v}
                                        type="button"
                                        aria-label={label}
                                        aria-pressed={view === v}
                                        onClick={() => choose(v)}
                                        className={cn(
                                            'grid h-[26px] w-[30px] place-items-center rounded-[7px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                                            view === v &&
                                                'bg-background text-foreground shadow-xs',
                                        )}
                                    >
                                        <Icon className="size-4" aria-hidden />
                                    </button>
                                ))}
                            </div>
                            <Button asChild className="ml-auto">
                                <Link href="/connections/create">
                                    <Plus aria-hidden />
                                    New connection
                                </Link>
                            </Button>
                        </div>
                    )}
                </ConnectionsHero>

                {connections.length === 0 ? (
                    <ConnectionsEmpty canTryDemo={canTryDemo} />
                ) : shown.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-sm text-muted-foreground">
                        <p>No connection matches "{query.trim()}"</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setQuery('');
                                search.current?.focus();
                            }}
                        >
                            Clear
                        </Button>
                    </div>
                ) : view === 'cards' ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4 px-6 pt-1 pb-10 sm:px-10">
                        {shown.map((c, i) => (
                            <ConnectionCard
                                key={c.id}
                                connection={c}
                                index={i}
                            />
                        ))}
                        <NewConnectionCard index={shown.length} />
                    </div>
                ) : (
                    <div className="px-6 pt-1 pb-10 sm:px-10">
                        <ul
                            aria-label="Connections"
                            className="divide-y rounded-[14px] border bg-card"
                        >
                            {shown.map((c) => (
                                <ConnectionRow key={c.id} connection={c} />
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </>
    );
}

ConnectionsIndex.layout = {
    breadcrumbs: [{ title: 'Connections', href: '/connections' }],
};
