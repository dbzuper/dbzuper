import { type CSSProperties, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { onWish, SEVEN, WISH_LINE } from '@/lib/easter-eggs';
import { prefersReducedMotion } from '@/universe/motion';

const ORBS = Array.from({ length: SEVEN }, (_, i) => (360 / SEVEN) * i - 90);

/**
 * The hidden "Make a wish" command's answer: a burst of light over the workspace with seven orange
 * orbs flying out, then a toast. With reduced motion it is only the toast. It never takes a click.
 */
export function WishBurst() {
    const [burst, setBurst] = useState<number | null>(null);

    useEffect(
        () =>
            onWish(() => {
                toast(WISH_LINE);
                if (!prefersReducedMotion()) setBurst(Date.now());
            }),
        [],
    );

    if (burst === null) return null;

    return (
        <div
            key={burst}
            data-testid="wish-burst"
            aria-hidden
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center overflow-hidden"
        >
            <div
                className="wish-glow absolute size-[min(80vmin,720px)] rounded-full"
                onAnimationEnd={() => setBurst(null)}
            />
            {ORBS.map((angle) => (
                <span
                    key={angle}
                    className="wish-orb absolute size-3 rounded-full"
                    style={
                        {
                            '--angle': `${angle}deg`,
                            '--reach': 'min(32vmin, 300px)',
                        } as CSSProperties
                    }
                />
            ))}
        </div>
    );
}
