/** Seeded PRNG; the same seed always yields the same sequence. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;

    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Cluster radius in CSS pixels at spread 1, stretched ×1.6 horizontally and ×0.8 vertically. */
const RADIUS_PX = 48;
const ATTEMPTS = 12;

export type StarScatter = {
    /** Drawing area in CSS pixels; the scatter is sized in pixels, then normalised. */
    width: number;
    height: number;
    spread?: number;
    /** Hero layout: clusters sit right of the text column. */
    hero?: boolean;
};

/**
 * Returns exactly `count` points in [0,1]². Given points are kept at their indexes; null or missing ones are
 * filled from a seeded PRNG, scattered around 2–4 cluster centres. The scatter radius is in pixels (like the
 * mockup), so a wide hero doesn't fill its band and a short card isn't flattened; a point that falls outside
 * the square is resampled rather than clamped onto the edge.
 */
export function starPoints(
    seed: number,
    count: number,
    given: ([number, number] | null)[] | null,
    { width, height, spread = 1, hero = false }: StarScatter,
): [number, number][] {
    const rand = mulberry32(seed);
    const clusters = 2 + Math.floor(rand() * 3);
    const centres = Array.from({ length: clusters }, () =>
        hero
            ? ([0.35 + rand() * 0.6, 0.2 + rand() * 0.6] as const)
            : ([0.2 + rand() * 0.6, 0.25 + rand() * 0.5] as const),
    );
    const rx = (RADIUS_PX * spread * 1.6) / Math.max(1, width);
    const ry = (RADIUS_PX * spread * 0.8) / Math.max(1, height);
    const points: [number, number][] = [];

    for (let i = 0; i < count; i++) {
        const [cx, cy] = centres[i % clusters];
        let generated: [number, number] = [cx, cy];

        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const angle = rand() * Math.PI * 2;
            const dist = Math.sqrt(rand());
            const x = cx + Math.cos(angle) * dist * rx;
            const y = cy + Math.sin(angle) * dist * ry;

            if (x > 0 && x < 1 && y > 0 && y < 1) {
                generated = [x, y];
                break;
            }
        }

        const point = given?.[i];

        points.push(point ? [clamp01(point[0]), clamp01(point[1])] : generated);
    }

    return points;
}
