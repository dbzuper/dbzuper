import { Link } from '@inertiajs/react';
import { Plus } from 'lucide-react';

const ENGINES = ['MySQL', 'MariaDB', 'PostgreSQL', 'SQLite'];

/** The dashed card at the end of the cards grid. */
export function NewConnectionCard({ index }: { index: number }) {
    return (
        <Link
            href="/connections/create"
            className="flex min-h-[290px] flex-col items-center justify-center gap-2.5 rounded-[14px] border border-dashed text-muted-foreground transition-colors ease-[cubic-bezier(0.2,0.7,0.2,1)] outline-none hover:border-primary hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:animate-in motion-safe:animation-duration-[450ms] motion-safe:fade-in-0 motion-safe:fill-mode-both motion-safe:slide-in-from-bottom-2"
            style={{ animationDelay: `${index * 50}ms` }}
        >
            <span className="grid size-11 place-items-center rounded-xl bg-muted text-foreground">
                <Plus className="size-4" aria-hidden />
            </span>
            <span className="font-semibold">New connection</span>
            <span className="flex flex-wrap justify-center gap-1.5">
                {ENGINES.map((e) => (
                    <span
                        key={e}
                        className="rounded-full bg-muted px-[7px] py-0.5 font-mono text-[10px] font-semibold"
                    >
                        {e}
                    </span>
                ))}
            </span>
        </Link>
    );
}
