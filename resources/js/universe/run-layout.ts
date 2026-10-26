import { computeLayout, type LayoutInput, type Positions } from './layout';

/** Runs the layout in a Web Worker; falls back to in-thread computation where workers are unavailable (tests). */
export function runLayout(
    input: LayoutInput,
    iterations?: number,
): Promise<Positions> {
    if (typeof Worker === 'undefined')
        return Promise.resolve(computeLayout(input, iterations));

    let worker: Worker;
    try {
        worker = new Worker(new URL('./layout.worker.ts', import.meta.url), {
            type: 'module',
        });
    } catch {
        // Browsers refuse a worker script from another origin, as the Vite dev server serves it.
        try {
            return Promise.resolve(computeLayout(input, iterations));
        } catch (err) {
            return Promise.reject(err);
        }
    }

    return new Promise((resolve, reject) => {
        const fallback = () => {
            worker.terminate();
            try {
                resolve(computeLayout(input, iterations));
            } catch (err) {
                reject(err);
            }
        };
        worker.onmessage = (e: MessageEvent<Positions>) => {
            worker.terminate();
            resolve(e.data);
        };
        worker.onerror = fallback;
        worker.onmessageerror = fallback;
        try {
            worker.postMessage({ input, iterations });
        } catch {
            fallback();
        }
    });
}
