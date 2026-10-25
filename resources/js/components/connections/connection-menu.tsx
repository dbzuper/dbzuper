import { Link, router } from '@inertiajs/react';
import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ConnectionSummary } from '@/types/connection';

/** Removes a saved connection after the user confirms; the database itself is untouched. */
export function removeConnection(c: ConnectionSummary) {
    if (
        window.confirm(
            `Remove the saved connection "${c.name}"? The database itself is not affected.`,
        )
    ) {
        router.delete(`/connections/${c.id}`);
    }
}

/** The ⋯ menu on a connection card or row: Edit and Remove. */
export function ConnectionMenu({
    connection,
    className,
}: {
    connection: ConnectionSummary;
    className?: string;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                aria-label={`More actions for ${connection.name}`}
                className={cn(
                    'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-foreground',
                    className,
                )}
            >
                <Ellipsis className="size-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                    <Link href={`/connections/${connection.id}/edit`}>
                        <Pencil aria-hidden />
                        Edit
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => removeConnection(connection)}
                >
                    <Trash2 aria-hidden />
                    Remove
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
