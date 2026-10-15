import { computeLayout, type LayoutInput, type Positions } from './layout';

/** Runs the layout in a Web Worker; falls back to in-thread computation where workers are unavailable (tests). */
export function runLayout(
    input: LayoutInput,
    iterations?: number,
): Promise<Positions> {
    if (typeof Worker === 'undefined')
        return Promise.resolve(computeLayout(input, iterations));

    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL('./layout.worker.ts', import.meta.url),
            { type: 'module' },
        );
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
