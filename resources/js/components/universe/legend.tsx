export function Legend() {
    return (
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-4 rounded-md border bg-background/80 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
            <span className="flex items-center gap-1.5">
                <span
                    className="h-0.5 w-5 rounded"
                    style={{ background: 'var(--universe-edge)' }}
                />{' '}
                foreign key
            </span>
            <span className="flex items-center gap-1.5">
                <span
                    className="h-px w-5 rounded"
                    style={{ background: 'var(--universe-edge-inferred)' }}
                />{' '}
                inferred
            </span>
            <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full border border-muted-foreground/60 bg-muted-foreground/30" />{' '}
                view
            </span>
        </div>
    );
}
