import { hasWebGL } from '@/universe/webgl';

let started: Promise<unknown> | null = null;

/**
 * Warms the browser cache with the chunks a workspace visit needs (the page, the universe model kit and,
 * where WebGL2 is available, the universe canvas), so opening a connection does not wait on them.
 * Called on hover or focus of a connection link; later calls are no-ops. Failures are ignored:
 * the real navigation fetches the chunks again and reports its own errors.
 */
export function prefetchWorkspace(): void {
    started ??= Promise.allSettled([
        import('@/pages/workspace/show'),
        import('@/universe/model-kit'),
        // Sigma touches the WebGL2 global at import time, so the canvas is only loaded when it is safe.
        hasWebGL() ? import('@/components/universe/universe-canvas') : null,
    ]);
}
