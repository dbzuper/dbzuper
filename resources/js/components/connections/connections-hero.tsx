import { usePage } from '@inertiajs/react';
import type { ReactNode } from 'react';
import { Count } from '@/components/connections/connection-card';
import { StarMap } from '@/components/connections/star-map';
import { formatSnapshotAge } from '@/lib/format';
import type { ConnectionCard } from '@/types/connection';

const HERO_SEED = 21;

function greeting(now: Date) {
    const h = now.getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Stat({ children }: { children: ReactNode }) {
    return (
        <li className="inline-flex items-baseline gap-1.5 rounded-full bg-muted/80 px-3 py-1.5 text-[13px] text-muted-foreground backdrop-blur-sm">
            {children}
        </li>
    );
}

/** The page header: greeting, title, summary chips and the tools (search, view switch, New connection). */
export function ConnectionsHero({
    connections,
    children,
}: {
    connections: ConnectionCard[];
    children?: ReactNode;
}) {
    const first = usePage().props.auth.user.name.trim().split(/\s+/)[0];
    const tables = connections.reduce((sum, c) => sum + (c.tables ?? 0), 0);
    const engines = new Set(connections.map((c) => c.driver)).size;
    const last = connections
        .filter((c) => c.last_opened_at)
        .reduce<ConnectionCard | null>(
            (best, c) =>
                !best ||
                Date.parse(c.last_opened_at!) > Date.parse(best.last_opened_at!)
                    ? c
                    : best,
            null,
        );

    return (
        <section className="relative overflow-hidden px-6 pt-8 pb-6 sm:px-10">
            <StarMap
                seed={HERO_SEED}
                star={null}
                color="var(--primary)"
                density="hero"
                className="pointer-events-none absolute inset-0 opacity-90"
            />
            <div className="relative">
                <p className="text-[13px] text-muted-foreground">
                    {greeting(new Date())}, {first}
                </p>
                <h1 className="mt-1 mb-2.5 text-3xl font-semibold tracking-tight">
                    Your databases
                </h1>
                {connections.length > 0 && (
                    <ul aria-label="Summary" className="flex flex-wrap gap-2">
                        <Stat>
                            <Count n={connections.length} word="connection" />
                        </Stat>
                        <Stat>
                            <Count n={tables} word="table" /> mapped
                        </Stat>
                        <Stat>
                            <Count n={engines} word="engine" />
                        </Stat>
                        {last && (
                            <Stat>
                                last opened{' '}
                                <b className="font-semibold text-foreground">
                                    {last.name}
                                </b>{' '}
                                · {formatSnapshotAge(last.last_opened_at!)}
                            </Stat>
                        )}
                    </ul>
                )}
                {children}
            </div>
        </section>
    );
}
