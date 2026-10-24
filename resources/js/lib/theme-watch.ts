/**
 * Calls `cb` whenever <html> changes mode (the `dark` class) or colour theme (`data-theme`). Returns a
 * function that stops watching. Other class changes also fire it, so callers compare what they need.
 */
export function watchThemeChanges(cb: () => void): () => void {
    const observer = new MutationObserver(() => cb());

    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme'],
    });

    return () => observer.disconnect();
}
