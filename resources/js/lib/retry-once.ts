/**
 * Wraps an async loader so concurrent and later callers share one successful result, but a
 * rejection is not cached: the next call starts the loader again (a transient chunk failure
 * must not break every later attempt).
 */
export function retryable<T>(loader: () => Promise<T>): () => Promise<T> {
    let pending: Promise<T> | null = null;
    return () => {
        if (pending) return pending;
        const attempt = loader().catch((error: unknown) => {
            if (pending === attempt) pending = null;
            throw error;
        });
        pending = attempt;
        return attempt;
    };
}
