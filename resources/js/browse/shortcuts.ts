import { isApplePlatform } from '@/lib/platform';

export type BrowseKeyAction =
    | { type: 'quickOpen' }
    | { type: 'toggleSidebar' }
    | { type: 'focusSearch' }
    | { type: 'focusFilter' }
    | { type: 'closeTab' }
    | { type: 'jumpTab'; index: number }
    | { type: 'cycleTab'; dir: 1 | -1 };

export type KeyLike = {
    key: string;
    code?: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    repeat?: boolean;
};

/** `typing` is true when focus is in an input, textarea, select, contenteditable or Monaco. */
export function browseKeyAction(
    e: KeyLike,
    ctx: { typing: boolean; tableTabActive: boolean },
): BrowseKeyAction | null {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (mod && !e.altKey && !e.shiftKey) {
        if (k === 'p') return { type: 'quickOpen' };
        if (k === 'b') return { type: 'toggleSidebar' };
        if (k === 'f' && ctx.tableTabActive && !ctx.typing)
            return { type: 'focusFilter' };
        return null;
    }
    if (ctx.typing) return null;

    if (!mod && !e.altKey && !e.shiftKey && e.key === '/')
        return { type: 'focusSearch' };

    if (e.altKey && !mod && !e.shiftKey) {
        if (e.code === 'KeyW' || k === 'w')
            return e.repeat ? null : { type: 'closeTab' };
        const digit = /^Digit([1-9])$/.exec(e.code ?? '');
        if (digit) return { type: 'jumpTab', index: Number(digit[1]) - 1 };
        if (e.key === 'PageDown') return { type: 'cycleTab', dir: 1 };
        if (e.key === 'PageUp') return { type: 'cycleTab', dir: -1 };
    }
    return null;
}

export function isTypingTarget(el: Element | null): boolean {
    if (!el) return false;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
    if (el instanceof HTMLElement && el.isContentEditable) return true;
    // jsdom implements neither isContentEditable nor the contentEditable reflection.
    const ce =
        el.getAttribute('contenteditable') ??
        (el as HTMLElement).contentEditable;
    if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true;
    return el.closest('.monaco-editor') !== null;
}

/** The shortcuts the header's help lists. */
export const SHORTCUTS: { keys: string; label: string }[] = (() => {
    const m = isApplePlatform() ? '⌘' : 'Ctrl';
    const a = isApplePlatform() ? '⌥' : 'Alt';
    return [
        { keys: `${m} K`, label: 'Command palette' },
        { keys: `${m} P`, label: 'Open a table' },
        { keys: `${m} B`, label: 'Toggle table sidebar' },
        { keys: `${m} J`, label: 'Toggle SQL dock' },
        { keys: '/', label: 'Search tables' },
        { keys: `${m} F`, label: 'Filter the table' },
        { keys: `${a} W`, label: 'Close tab' },
        { keys: `${a} 1–9`, label: 'Jump to tab' },
        { keys: 'Enter', label: 'Open row details (grid)' },
        { keys: 'Esc', label: 'Close row details' },
        { keys: 'Shift Enter', label: 'Palette: show table in Universe' },
        { keys: `${a} PgUp / PgDn`, label: 'Previous / next tab' },
    ];
})();
