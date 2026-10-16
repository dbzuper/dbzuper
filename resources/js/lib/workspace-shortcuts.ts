import { useSidebarPrefs } from '@/browse/sidebar-prefs';
import { useWorkspace } from '@/universe/store';

/**
 * The workspace's global shortcuts, shared by the window key handlers and the SQL editor, which
 * swallows these keys (Ctrl/⌘+K starts a Monaco chord) and so registers them as editor commands.
 */

let paletteOpener: HTMLElement | null = null;

/** Ctrl/⌘+K (all) and Ctrl/⌘+P (tables only): open or close the command palette. */
export function togglePalette(mode: 'all' | 'tables' = 'all'): void {
    const st = useWorkspace.getState();
    // Remembered before the palette renders: the dialog's own record of it can come too late (for the
    // SQL editor it ends up on the body), and Esc should return to where typing was.
    if (!st.paletteOpen)
        paletteOpener =
            document.activeElement instanceof HTMLElement &&
            document.activeElement !== document.body
                ? document.activeElement
                : null;
    st.setPaletteOpen(!st.paletteOpen, mode);
}

/** The element that had focus when the shortcut opened the palette (once; null if gone). */
export function takePaletteOpener(): HTMLElement | null {
    const el = paletteOpener;
    paletteOpener = null;
    return el?.isConnected ? el : null;
}

/** Ctrl/⌘+J: open or close the SQL dock, unless the palette or another modal dialog is open. */
export function toggleDock(repeat = false): void {
    const st = useWorkspace.getState();
    if (
        repeat ||
        st.paletteOpen ||
        document.querySelector('[role="dialog"]:not([aria-modal="false"])')
    )
        return;
    st.setDockOpen(!st.dockOpen);
}

/** True while the palette or another modal dialog is open, when browse shortcuts must stay quiet. */
export function modalOpen(): boolean {
    return (
        useWorkspace.getState().paletteOpen ||
        document.querySelector('[role="dialog"]:not([aria-modal="false"])') !==
            null
    );
}

/** Ctrl/⌘+B: collapse or expand the table sidebar, unless a modal is open. */
export function toggleSidebar(): void {
    if (modalOpen()) return;
    useSidebarPrefs.getState().toggle();
}
