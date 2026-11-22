import { ArchiveRestore, ChevronDown, DatabaseBackup } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ConnectionSummary } from '@/types/connection';
import { useWorkspace } from '@/universe/store';

export const READ_ONLY_REASON = 'This connection is read-only';

/** The workspace header's "Backup & restore" menu: opens the backup or the restore dialog. */
export function TransfersMenu({
    connection,
}: {
    connection: Pick<ConnectionSummary, 'read_only'>;
}) {
    const setTransferDialog = useWorkspace((s) => s.setTransferDialog);
    const reasonId = useId();
    const readOnly = connection.read_only;

    return (
        // A local provider: Radix tooltips throw without one, and the app-level one is absent in tests.
        <TooltipProvider delayDuration={0}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                        <DatabaseBackup className="size-3.5" aria-hidden />
                        Backup &amp; restore
                        <ChevronDown
                            className="size-3 text-muted-foreground"
                            aria-hidden
                        />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                        onSelect={() => setTransferDialog('backup')}
                    >
                        <DatabaseBackup aria-hidden />
                        Back up…
                    </DropdownMenuItem>
                    {readOnly && (
                        <span id={reasonId} className="sr-only">
                            {READ_ONLY_REASON}
                        </span>
                    )}
                    {readOnly ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                {/* Not Radix-disabled: a disabled item can't be focused or hovered, so the reason
                                    would never show. It does nothing when chosen. */}
                                <DropdownMenuItem
                                    aria-disabled="true"
                                    aria-describedby={reasonId}
                                    className="cursor-not-allowed opacity-50"
                                    onSelect={(e) => e.preventDefault()}
                                >
                                    <ArchiveRestore aria-hidden />
                                    Restore…
                                </DropdownMenuItem>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                                {READ_ONLY_REASON}
                            </TooltipContent>
                        </Tooltip>
                    ) : (
                        <DropdownMenuItem
                            onSelect={() => setTransferDialog('restore')}
                        >
                            <ArchiveRestore aria-hidden />
                            Restore…
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </TooltipProvider>
    );
}
