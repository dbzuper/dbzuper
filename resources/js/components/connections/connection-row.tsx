import { Link } from '@inertiajs/react';
import { Lock } from 'lucide-react';
import {
    colorStyle,
    openedLabel,
    plural,
    STRETCHED,
    STRETCHED_FOCUS,
} from '@/components/connections/connection-card';
import { ConnectionMenu } from '@/components/connections/connection-menu';
import { formatConnectionTarget } from '@/lib/format';
import { prefetchWorkspace } from '@/lib/prefetch-workspace';
import { cn } from '@/lib/utils';
import type { ConnectionCard } from '@/types/connection';

function counts(c: ConnectionCard) {
    if (c.tables === null) return 'not mapped yet';
    const tables = plural(c.tables, 'table');
    return c.views ? `${tables} · ${plural(c.views, 'view')}` : tables;
}

/** A connection in the list view; the whole row opens the workspace. */
export function ConnectionRow({
    connection: c,
}: {
    connection: ConnectionCard;
}) {
    return (
        <li
            className={cn(
                'relative flex items-center gap-4 px-4 py-3 transition-colors first:rounded-t-[13px] last:rounded-b-[13px] hover:bg-accent/50',
                STRETCHED_FOCUS,
            )}
            style={colorStyle(c)}
        >
            <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full bg-(--c) shadow-[0_0_0_3px_color-mix(in_oklab,var(--c)_22%,transparent)]"
            />
            <div className="min-w-0 flex-1">
                <Link
                    href={`/c/${c.id}`}
                    data-card-link
                    aria-label={`Open ${c.name}`}
                    className={cn('block truncate font-medium', STRETCHED)}
                    onMouseEnter={prefetchWorkspace}
                    onFocus={prefetchWorkspace}
                >
                    {c.name}
                </Link>
                <div className="truncate font-mono text-xs text-muted-foreground">
                    {formatConnectionTarget(c)}
                </div>
            </div>
            {c.read_only && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-warning-foreground">
                    <Lock className="size-3" aria-hidden />
                    read-only
                </span>
            )}
            <span className="hidden w-20 shrink-0 text-xs text-muted-foreground sm:block">
                {c.driver_label}
            </span>
            <span className="hidden w-36 shrink-0 text-xs text-muted-foreground tabular-nums md:block">
                {counts(c)}
            </span>
            <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground lg:block">
                {openedLabel(c)}
            </span>
            <ConnectionMenu connection={c} className="relative z-10 shrink-0" />
        </li>
    );
}
