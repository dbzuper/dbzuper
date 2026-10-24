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

/**
 * Returns exactly `count` points in [0,1]². Given points are kept at their indexes; null or missing ones are
 * filled from a seeded PRNG, scattered around 2–4 cluster centres.
 */
export function starPoints(
    seed: number,
    count: number,
    given: ([number, number] | null)[] | null,
    spread = 1,
): [number, number][] {
    const rand = mulberry32(seed);
    const clusters = 2 + Math.floor(rand() * 3);
    const centres = Array.from(
        { length: clusters },
        () => [0.2 + rand() * 0.6, 0.25 + rand() * 0.5] as const,
    );
    const points: [number, number][] = [];

    for (let i = 0; i < count; i++) {
        const [cx, cy] = centres[i % clusters];
        const angle = rand() * Math.PI * 2;
        const dist = Math.sqrt(rand()) * 0.2 * spread;
        const generated: [number, number] = [
            clamp01(cx + Math.cos(angle) * dist * 1.6),
            clamp01(cy + Math.sin(angle) * dist * 0.8),
        ];
        const point = given?.[i];

        points.push(point ? [clamp01(point[0]), clamp01(point[1])] : generated);
    }

    return points;
}
