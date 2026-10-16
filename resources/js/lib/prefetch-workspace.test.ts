import { beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.fn();
const kit = vi.fn();
const canvas = vi.fn();

async function load(webgl: boolean) {
    vi.resetModules();
    show.mockClear();
    kit.mockClear();
    canvas.mockClear();
    vi.doMock(
        '@/pages/workspace/show',
        () => (show(), { default: () => null }),
    );
    vi.doMock('@/universe/model-kit', () => (kit(), {}));
    vi.doMock('@/components/universe/universe-canvas', () => (canvas(), {}));
    vi.doMock('@/universe/webgl', () => ({ hasWebGL: () => webgl }));
    return import('./prefetch-workspace');
}

describe('prefetchWorkspace', () => {
    beforeEach(() => vi.resetModules());

    it('loads the page, the model kit and the canvas once', async () => {
        const { prefetchWorkspace } = await load(true);
        prefetchWorkspace();
        prefetchWorkspace();
        await vi.waitFor(() => expect(canvas).toHaveBeenCalledTimes(1));
        expect(show).toHaveBeenCalledTimes(1);
        expect(kit).toHaveBeenCalledTimes(1);
    });

    it('skips the canvas without WebGL2', async () => {
        const { prefetchWorkspace } = await load(false);
        prefetchWorkspace();
        await vi.waitFor(() => expect(kit).toHaveBeenCalledTimes(1));
        expect(show).toHaveBeenCalledTimes(1);
        expect(canvas).not.toHaveBeenCalled();
    });
});
