import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
});

async function load() {
    return (await import('./webgl')).hasWebGL;
}

describe('hasWebGL', () => {
    it('is false when the WebGL2RenderingContext global is missing', async () => {
        vi.stubGlobal('WebGL2RenderingContext', undefined);
        const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
        const hasWebGL = await load();
        expect(hasWebGL()).toBe(false);
        expect(getContext).not.toHaveBeenCalled();
    });

    it('requires a webgl2 context, not plain webgl', async () => {
        vi.stubGlobal(
            'WebGL2RenderingContext',
            function WebGL2RenderingContext() {},
        );
        const getContext = vi
            .spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockImplementation(((type: string) =>
                type === 'webgl' ? ({} as RenderingContext) : null) as never);
        const hasWebGL = await load();
        expect(hasWebGL()).toBe(false);
        expect(getContext).toHaveBeenCalledWith('webgl2');
    });

    it('is true with a webgl2 context and caches the probe', async () => {
        vi.stubGlobal(
            'WebGL2RenderingContext',
            function WebGL2RenderingContext() {},
        );
        const getContext = vi
            .spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockImplementation(((type: string) =>
                type === 'webgl2'
                    ? ({
                          getExtension: () => null,
                      } as unknown as RenderingContext)
                    : null) as never);
        const hasWebGL = await load();
        expect(hasWebGL()).toBe(true);
        expect(hasWebGL()).toBe(true);
        expect(getContext).toHaveBeenCalledTimes(1);
    });

    it('is false when probing throws', async () => {
        vi.stubGlobal(
            'WebGL2RenderingContext',
            function WebGL2RenderingContext() {},
        );
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
            () => {
                throw new Error('nope');
            },
        );
        const hasWebGL = await load();
        expect(hasWebGL()).toBe(false);
    });
});
