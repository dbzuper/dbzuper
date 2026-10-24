import { Link } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Keyboard, RefreshCw, Search } from 'lucide-react';
import { SHORTCUTS } from '@/browse/shortcuts';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { paletteShortcutHint } from '@/lib/platform';
import type { ConnectionSummary } from '@/types/connection';
import { useWorkspace } from '@/universe/store';

type Props = {
    connection: ConnectionSummary;
    loading: boolean;
    onRefresh: () => void;
};

export function WorkspaceHeader({ connection, loading, onRefresh }: Props) {
    const showInferred = useWorkspace((s) => s.showInferred);
    const toggleInferred = useWorkspace((s) => s.toggleInferred);
    const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);

    return (
        <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
            <Link
                href="/connections"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" /> Connections
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <div className="inline-flex min-w-0 items-center gap-2 rounded-full border bg-card px-2.5 py-0.5">
                <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                        background:
                            connection.color ?? 'var(--universe-accent)',
                    }}
                    aria-hidden
                />
                <h1 className="truncate text-sm font-semibold">
                    {connection.name}
                </h1>
                <span className="font-mono text-[11px] text-muted-foreground">
                    {connection.driver_label}
                </span>
            </div>
            {connection.read_only && (
                <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    read-only
                </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPaletteOpen(true)}
                    aria-keyshortcuts="Control+K Meta+K"
                >
                    <Search className="size-3.5" /> Search{' '}
                    <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">
                        {paletteShortcutHint()}
                    </kbd>
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleInferred}
                    aria-pressed={showInferred}
                >
                    {showInferred ? 'Hide inferred' : 'Show inferred'}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRefresh}
                    disabled={loading}
                >
                    <RefreshCw
                        className={
                            loading
                                ? 'size-3.5 animate-spin motion-reduce:animate-none'
                                : 'size-3.5'
                        }
                    />
                    {loading ? 'Loading…' : 'Refresh schema'}
                </Button>
                <ShortcutHelp />
                <ThemeToggle />
            </div>
        </header>
    );
}

/** A disclosure (not a menu: it holds no actions) listing the keyboard shortcuts. */
function ShortcutHelp() {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);
    return (
        <div ref={root} className="relative">
            <Button
                variant="ghost"
                size="icon"
                aria-label="Keyboard shortcuts"
                aria-expanded={open}
                aria-controls="shortcut-help"
                onClick={() => setOpen((o) => !o)}
            >
                <Keyboard className="size-4" />
            </Button>
            {open && (
                <div
                    id="shortcut-help"
                    role="region"
                    aria-label="Keyboard shortcuts"
                    className="absolute right-0 z-50 mt-1 w-72 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
                >
                    <dl className="grid gap-1.5 text-xs">
                        {SHORTCUTS.map((s) => (
                            <div
                                key={s.label}
                                className="flex items-center justify-between gap-3"
                            >
                                <dt>{s.label}</dt>
                                <dd>
                                    <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                        {s.keys}
                                    </kbd>
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}
        </div>
    );
}
