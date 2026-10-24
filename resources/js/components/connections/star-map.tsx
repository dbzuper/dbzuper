import { useEffect, useRef } from 'react';
import { mulberry32, starPoints } from '@/components/connections/star-layout';
import { watchThemeChanges } from '@/lib/theme-watch';
import { cn } from '@/lib/utils';
import type { ConnectionCard } from '@/types/connection';

const PAD = 6;

type Props = {
    seed: number;
    star: ConnectionCard['star'];
    color?: string;
    density?: 'card' | 'hero';
    className?: string;
};

export function StarMap({
    seed,
    star,
    color = 'var(--universe-accent)',
    density = 'card',
    className,
}: Props) {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;

        if (!canvas) {
            return;
        }

        const draw = () => {
            const ctx = canvas.getContext('2d');
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;

            if (!ctx || w === 0 || h === 0) {
                return;
            }

            const hero = density === 'hero';
            const dpr = window.devicePixelRatio || 1;

            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            // CSS variables don't work in canvas fillStyle, so resolve against the element.
            let resolved = color;
            const match = /^var\((--[^,)]+)(?:,\s*([^)]+))?\)$/.exec(
                color.trim(),
            );

            if (match) {
                resolved =
                    getComputedStyle(canvas)
                        .getPropertyValue(match[1])
                        .trim() ||
                    match[2]?.trim() ||
                    '#888';
            }

            const count = star ? star.count : hero ? 90 : 24;
            const pts = starPoints(seed, count, star?.points ?? null);
            const rand = mulberry32(seed + 1);
            const edges: [number, number][] = star
                ? star.edges
                : pts.flatMap((_, i) =>
                      i > 0 && rand() < 0.55
                          ? [[i, Math.floor(rand() * i)] as [number, number]]
                          : [],
                  );
            const px = (p: [number, number]): [number, number] => [
                PAD + p[0] * (w - 2 * PAD),
                PAD + p[1] * (h - 2 * PAD),
            ];

            ctx.strokeStyle = resolved;
            ctx.globalAlpha = 0.18;
            ctx.lineWidth = 0.8;

            for (const [a, b] of edges) {
                if (a === b || !pts[a] || !pts[b]) {
                    continue;
                }

                const [x1, y1] = px(pts[a]);
                const [x2, y2] = px(pts[b]);

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }

            ctx.fillStyle = resolved;
            ctx.globalAlpha = 0.85;

            if (!hero) {
                ctx.shadowColor = resolved;
                ctx.shadowBlur = 6;
            }

            pts.forEach((p, i) => {
                const [x, y] = px(p);
                const radius =
                    1 +
                    ((((Math.sin(seed + i * 12.9898) * 43758.5453) % 1) + 1) %
                        1) *
                        1.6;

                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        };

        draw();

        const observer =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(draw);

        observer?.observe(canvas);

        const stopWatching = watchThemeChanges(draw);

        return () => {
            observer?.disconnect();
            stopWatching();
        };
    }, [seed, star, color, density]);

    return (
        <canvas
            ref={ref}
            aria-hidden="true"
            className={cn('size-full', className)}
        />
    );
}
