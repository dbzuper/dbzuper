import type { WorkspaceState } from './store';

/**
 * Unwinds one layer of workspace state. Path, focus and selection belong to the Universe tab, so on
 * another tab (`universeActive` false) only the history panel closes.
 */
export function handleEscape(
    s: WorkspaceState,
    universeActive = true,
): boolean {
    if (!universeActive) {
        if (!s.historyOpen) return false;
        s.setHistoryOpen(false);
        return true;
    }
    if (s.pathFrom || s.path) {
        s.clearPath();
        return true;
    }
    if (s.focus) {
        s.setFocus(null);
        return true;
    }
    if (s.historyOpen) {
        s.setHistoryOpen(false);
        return true;
    }
    if (s.selected) {
        s.select(null);
        return true;
    }
    return false;
}

/**
 * True when a page-level Escape should be left alone: another layer (a Radix dialog, the palette)
 * already handled it, or the user is typing in a text field.
 */
export function escapeHandledElsewhere(e: KeyboardEvent): boolean {
    if (e.defaultPrevented) return true;
    const t = e.target;
    return (
        t instanceof Element &&
        t.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        ) !== null
    );
}
