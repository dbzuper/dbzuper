/** Lets keyboard users jump past the navigation; visible only while focused. */
export function SkipLink({ targetId = 'main' }: { targetId?: string }) {
    return (
        <a
            href={`#${targetId}`}
            className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100]"
        >
            Skip to main content
        </a>
    );
}
