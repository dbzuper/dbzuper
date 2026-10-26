import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeLayout, type LayoutInput } from './layout';
import { runLayout } from './run-layout';

const input: LayoutInput = {
    nodes: [
        { key: 'users', cluster: 'c0', size: 5 },
        { key: 'orders', cluster: 'c0', size: 5 },
    ],
    edges: [{ source: 'orders', target: 'users', weight: 1 }],
    clusters: [{ id: 'c0', outer: false }],
};

afterEach(() => vi.unstubAllGlobals());

describe('runLayout', () => {
    it('lays out in this thread when the worker cannot be created', async () => {
        // The Vite dev server serves the worker from another origin, which browsers refuse.
        vi.stubGlobal(
            'Worker',
            class {
                constructor() {
                    throw new DOMException(
                        "Failed to construct 'Worker'",
                        'SecurityError',
                    );
                }
            },
        );

        await expect(runLayout(input, 50)).resolves.toEqual(
            computeLayout(input, 50),
        );
    });
});
