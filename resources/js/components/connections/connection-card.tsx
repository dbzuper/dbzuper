import { Link } from '@inertiajs/react';
import {
    ArrowRight,
    Camera,
    Clock3,
    Eye,
    Lock,
    Settings2,
    Star,
    Table2,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { ConnectionMenu } from '@/components/connections/connection-menu';
import { StarMap } from '@/components/connections/star-map';
import { formatCardTarget, formatSnapshotAge } from '@/lib/format';
import { prefetchWorkspace } from '@/lib/prefetch-workspace';
import { cn } from '@/lib/utils';
import type { ConnectionCard as Card, DriverValue } from '@/types/connection';

const PIN_CHIPS = 4;

/** Entrance stagger steps; later cards share the last delay so a long list doesn't trickle in. */
export const MAX_STAGGER = 8;

const GLYPHS: Record<DriverValue, string> = {
    mysql: 'My',
    mariadb: 'Ma',
    pgsql: 'Pg',
    sqlite: 'SQ',
};

const SKY =
    'radial-gradient(120% 90% at 85% 0%, color-mix(in oklab, var(--c) 22%, transparent), transparent 60%), color-mix(in oklab, var(--c) 6%, var(--muted))';

const count = new Intl.NumberFormat('en');

export const plural = (n: number, word: string) =>
    `${count.format(n)} ${word}${n === 1 ? '' : 's'}`;

/** The connection's colour, or the theme accent when it has none. */
export const connectionColor = (c: Card) => c.color ?? 'var(--universe-accent)';

/** Exposes the connection colour to the card's styles as `--c`. */
export const colorStyle = (c: Card, extra?: CSSProperties) =>
    ({ '--c': connectionColor(c), ...extra }) as CSSProperties;

/** Stretched link: its ::after covers the nearest positioned ancestor, so the whole card or row opens it. */
export const STRETCHED =
    "outline-none after:absolute after:inset-0 after:content-['']";

/** The existing focus ring, drawn on the card or row while its stretched link has keyboard focus. */
export const STRETCHED_FOCUS =
    'has-[[data-card-link]:focus-visible]:border-ring has-[[data-card-link]:focus-visible]:ring-[3px] has-[[data-card-link]:focus-visible]:ring-ring/50';

export function openedLabel(c: Card) {
    return c.last_opened_at
        ? `opened ${formatSnapshotAge(c.last_opened_at)}`
        : 'never opened';
}

/** "{n} {word}s" with the number emphasised. */
export function Count({ n, word }: { n: number; word: string }) {
    const [num, ...rest] = plural(n, word).split(' ');

    return (
        <>
            <b className="font-semibold text-foreground tabular-nums">{num}</b>{' '}
            {rest.join(' ')}
        </>
    );
}

/** A connection in the cards view: a star map band, name and target, counts, pinned tables and actions. */
export function ConnectionCard({
    connection: c,
    index,
}: {
    connection: Card;
    index: number;
}) {
    const extra = c.pins.length - PIN_CHIPS;

    return (
        <article
            className={cn(
                'group/card relative flex flex-col overflow-hidden rounded-[14px] border bg-card shadow-xs transition-[translate,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--c)_45%,var(--border))] hover:shadow-lg',
                'ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-safe:animate-in motion-safe:animation-duration-[450ms] motion-safe:fade-in-0 motion-safe:fill-mode-both motion-safe:slide-in-from-bottom-2',
                STRETCHED_FOCUS,
            )}
            style={colorStyle(c, {
                animationDelay: `${Math.min(index, MAX_STAGGER) * 50}ms`,
            })}
        >
            <div
                className="relative h-[118px] shrink-0"
                style={{ background: SKY }}
            >
                <StarMap
                    seed={c.id}
                    star={c.star}
                    color={connectionColor(c)}
                    className="absolute inset-0"
                />
                <span className="absolute bottom-3 left-3.5 inline-flex items-center gap-1.5 rounded-full bg-background/85 py-0.5 pr-2.5 pl-1 text-[11px] font-medium backdrop-blur-sm">
                    <span
                        aria-hidden
                        className="grid size-[18px] place-items-center rounded-full bg-[color-mix(in_oklab,var(--c)_30%,var(--card))] font-mono text-[9px] font-bold text-foreground"
                    >
                        {GLYPHS[c.driver]}
                    </span>
                    {c.driver_label}
                </span>
                {c.read_only && (
                    <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--warning)_14%,var(--background))] px-2 py-0.5 text-[10.5px] font-medium text-foreground">
                        <Lock
                            className="size-3 text-warning-foreground"
                            aria-hidden
                        />
                        read-only
                    </span>
                )}
            </div>

            <div className="flex flex-1 flex-col gap-2.5 px-4 pt-3.5 pb-3">
                <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight">
                    <span
                        aria-hidden
                        className="size-[9px] shrink-0 rounded-full bg-(--c) shadow-[0_0_0_3px_color-mix(in_oklab,var(--c)_22%,transparent)]"
                    />
                    <Link
                        href={`/c/${c.id}`}
                        data-card-link
                        aria-label={`Open ${c.name}`}
                        className={cn('truncate', STRETCHED)}
                        onMouseEnter={prefetchWorkspace}
                        onFocus={prefetchWorkspace}
                    >
                        {c.name}
                    </Link>
                </h2>
                <div className="truncate font-mono text-xs text-muted-foreground">
                    {formatCardTarget(c)}
                </div>
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground [&_svg]:size-[13px] [&_svg]:shrink-0">
                    {c.tables !== null && (
                        <span className="inline-flex items-center gap-1.5">
                            <Table2 aria-hidden />
                            <span>
                                <Count n={c.tables} word="table" />
                            </span>
                        </span>
                    )}
                    {!!c.views && (
                        <span className="inline-flex items-center gap-1.5">
                            <Eye aria-hidden />
                            <span>
                                <Count n={c.views} word="view" />
                            </span>
                        </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                        <Camera aria-hidden />
                        {c.snapshot_at
                            ? `snapshot ${formatSnapshotAge(c.snapshot_at)}`
                            : 'not mapped yet'}
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    {c.pins.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                            {c.server_level
                                ? 'Pick a database to start'
                                : 'No pinned tables yet'}
                        </span>
                    ) : (
                        c.pins.slice(0, PIN_CHIPS).map((table) => (
                            <Link
                                key={table}
                                href={`/c/${c.id}?tab=${encodeURIComponent(table)}`}
                                className="relative z-10 inline-flex max-w-full items-center gap-1 rounded-[7px] bg-muted px-2 py-0.5 font-mono text-[11.5px] font-medium text-foreground transition-colors outline-none hover:bg-[color-mix(in_oklab,var(--c)_18%,var(--muted))] focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                onMouseEnter={prefetchWorkspace}
                                onFocus={prefetchWorkspace}
                            >
                                <Star
                                    className="size-[11px] shrink-0 text-muted-foreground"
                                    aria-hidden
                                />
                                <span className="truncate">{table}</span>
                            </Link>
                        ))
                    )}
                    {extra > 0 && (
                        <span className="text-xs text-muted-foreground">
                            +{extra} more
                        </span>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-1.5 border-t py-2.5 pr-3 pl-4 text-xs text-muted-foreground">
                <Clock3 className="size-[13px] shrink-0" aria-hidden />
                <span className="truncate">{openedLabel(c)}</span>
                <Link
                    href={`/connections/${c.id}/edit`}
                    aria-label={`Edit ${c.name}`}
                    className="relative z-10 ml-auto grid size-7 shrink-0 place-items-center rounded-md transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    <Settings2 className="size-4" aria-hidden />
                </Link>
                <ConnectionMenu
                    connection={c}
                    className="relative z-10 shrink-0"
                />
                <span
                    aria-hidden
                    className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold text-foreground transition-colors group-hover/card:bg-[color-mix(in_oklab,var(--c)_30%,var(--card))]"
                >
                    Open
                    <ArrowRight className="size-3.5 transition-transform group-hover/card:translate-x-0.5" />
                </span>
            </div>
        </article>
    );
}
