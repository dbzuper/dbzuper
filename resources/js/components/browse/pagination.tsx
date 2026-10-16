import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PER_PAGE_OPTIONS, type PerPage } from '@/lib/workspace-api';

const fieldClass =
    'h-7 rounded-md border bg-background px-2 text-xs tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring';

type Props = {
    page: number;
    perPage: PerPage;
    /** Known only when the total is exact. */
    lastPage: number | null;
    hasMore: boolean;
    /** Disables the controls while nothing has loaded yet. */
    disabled?: boolean;
    label: string;
    onPage: (page: number) => void;
    onPerPage: (perPage: PerPage) => void;
    /** Shown after the range label (count status, Count exactly). */
    children?: ReactNode;
};

export function Pagination({
    page,
    perPage,
    lastPage,
    hasMore,
    disabled = false,
    label,
    onPage,
    onPerPage,
    children,
}: Props) {
    const [draft, setDraft] = useState<string | null>(null);
    const max = lastPage ?? page + (hasMore ? 1 : 0);

    const commit = () => {
        if (draft === null) return;
        setDraft(null);
        const n = Number.parseInt(draft, 10);
        if (!Number.isFinite(n)) return;
        const next = Math.min(Math.max(1, n), Math.max(1, max));
        if (next !== page) onPage(next);
    };

    return (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2 text-xs">
            <span className="text-muted-foreground tabular-nums">{label}</span>
            {children}
            <div className="ml-auto flex items-center gap-1">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="First page"
                    disabled={disabled || page <= 1}
                    onClick={() => onPage(1)}
                >
                    <ChevronsLeft className="size-4" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Previous page"
                    disabled={disabled || page <= 1}
                    onClick={() => onPage(page - 1)}
                >
                    <ChevronLeft className="size-4" />
                </Button>
                <input
                    aria-label="Page"
                    inputMode="numeric"
                    className={`${fieldClass} w-12 text-center`}
                    value={draft ?? String(page)}
                    disabled={disabled}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            commit();
                        } else if (e.key === 'Escape') setDraft(null);
                    }}
                />
                {lastPage !== null && (
                    <span className="text-muted-foreground tabular-nums">
                        of {lastPage}
                    </span>
                )}
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Next page"
                    disabled={disabled || !hasMore}
                    onClick={() => onPage(page + 1)}
                >
                    <ChevronRight className="size-4" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Last page"
                    disabled={disabled || lastPage === null || page >= lastPage}
                    onClick={() => lastPage !== null && onPage(lastPage)}
                >
                    <ChevronsRight className="size-4" />
                </Button>
                <select
                    aria-label="Rows per page"
                    className={fieldClass}
                    value={perPage}
                    onChange={(e) =>
                        onPerPage(Number(e.target.value) as PerPage)
                    }
                >
                    {PER_PAGE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                            {n} / page
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}
