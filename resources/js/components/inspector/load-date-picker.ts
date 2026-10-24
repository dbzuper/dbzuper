/**
 * The one import of the date picker chunk (react-day-picker, date-fns). It stays out of the eager chunks, but is
 * fetched ahead of need (a table with a date column, a pointer over a picker button) so a picker opens at once.
 */
type DatePickerModule = typeof import('./date-picker');

let loaded: DatePickerModule | undefined;
let loading: Promise<DatePickerModule> | undefined;

/** Loads the picker chunk; repeat calls share one promise. A failed load is forgotten, so a later call retries. */
export function loadDatePicker(): Promise<DatePickerModule> {
    loading ??= import('./date-picker').then(
        (module) => (loaded = module),
        (error: unknown) => {
            loading = undefined;
            throw error;
        },
    );
    return loading;
}

/** Starts loading the picker chunk ahead of need; a failure surfaces later, when a picker opens. */
export function preloadDatePicker(): void {
    loadDatePicker().catch(() => {});
}

/**
 * React.lazy's loader for an export of the picker module. Once the chunk is loaded it hands the export over
 * synchronously: lazy then renders it straight away rather than showing the Suspense fallback for a tick.
 */
export function datePickerExport<K extends 'default' | 'EditDatePicker'>(
    name: K,
): () => Promise<{ default: DatePickerModule[K] }> {
    return () => {
        const module = loaded;
        if (!module)
            return loadDatePicker().then((m) => ({ default: m[name] }));
        // A thenable that calls back at once; React.lazy accepts any thenable, its type says Promise.
        const ready = {
            // A thenable on purpose: React.lazy only calls `then`, and a synchronous call is what skips the fallback.
            // eslint-disable-next-line unicorn/no-thenable
            then: (
                resolve: (value: { default: DatePickerModule[K] }) => void,
            ) => resolve({ default: module[name] }),
        };
        return ready as unknown as Promise<{ default: DatePickerModule[K] }>;
    };
}
