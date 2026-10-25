import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const C = 128;

/** A wedge of the radar disc from angle a1 to a2 (degrees, 0 = east, clockwise). */
function wedge(r: number, a1: number, a2: number): string {
    const p = (a: number) =>
        `${(C + r * Math.cos((a * Math.PI) / 180)).toFixed(2)} ${(C + r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`;

    return `M${C} ${C}L${p(a1)}A${r} ${r} 0 0 1 ${p(a2)}Z`;
}

/** The sweep's trail: three slices fading out behind the leading edge, which starts pointing north. */
const TRAIL = [
    { d: wedge(92, -105, -90), opacity: 0.45 },
    { d: wedge(92, -120, -105), opacity: 0.25 },
    { d: wedge(92, -150, -120), opacity: 0.1 },
];

/**
 * The radar from the logo: a ring around the table-grid world, with a sweep turning over it and one
 * orange blip that lights up as the sweep passes. It follows currentColor; with reduced motion the sweep
 * stands still and the blip stays lit.
 */
export function RadarSweep({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 256 256"
            aria-hidden="true"
            className={cn('radar size-10 shrink-0', className)}
        >
            <circle
                cx={C}
                cy={C}
                r={100}
                fill="none"
                stroke="currentColor"
                strokeWidth={12}
                opacity={0.35}
            />
            <g opacity={0.3} fill="currentColor">
                <path d="M106.5 78.15H113.5V177.85H106.5ZM78.15 106.5H177.85V113.5H78.15ZM142.5 78.15H149.5V177.85H142.5ZM78.15 142.5H177.85V149.5H78.15Z" />
            </g>
            <circle
                cx={C}
                cy={C}
                r={58}
                fill="none"
                stroke="currentColor"
                strokeWidth={8}
                opacity={0.3}
            />
            <g className="radar-sweep" fill="currentColor">
                {TRAIL.map(({ d, opacity }) => (
                    <path key={d} d={d} opacity={opacity} />
                ))}
            </g>
            <circle
                className="radar-blip fill-logo-dot"
                cx={174}
                cy={82}
                r={14}
            />
        </svg>
    );
}

/** A loading state: the radar above its text, centred in the area. */
export function RadarLoader({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            role="status"
            className={cn(
                'flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground',
                className,
            )}
        >
            <RadarSweep className="text-primary" />
            <span>{children}</span>
        </div>
    );
}
