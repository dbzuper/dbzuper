import { TABLE_FILTER_ID } from '@/components/browse/data-view';
import { SIDEBAR_SEARCH_ID } from '@/components/browse/table-sidebar';
import { flushOpenEdits } from '@/editing/flush-edits';
import { usePending } from '@/editing/pending-store';
import { useReview } from '@/editing/review-store';
import { modalOpen, togglePalette } from '@/lib/workspace-shortcuts';
import { useBrowse } from './browse-store';
import { browseKeyAction, isTypingTarget } from './shortcuts';
import { useSidebarPrefs } from './sidebar-prefs';
import type { WorkspaceRef } from '@/types/connection';

/** Handles one window keydown for the browse shortcuts. Returns true when it claimed the key. */
export function dispatchBrowseKey(
    e: KeyboardEvent,
    connectionId: WorkspaceRef,
    tableTabActive: boolean,
): boolean {
    const action = browseKeyAction(e, {
        typing: isTypingTarget(document.activeElement),
        tableTabActive,
    });
    if (!action) return false;
    const filter = document.getElementById(TABLE_FILTER_ID);
    // Ctrl+F with no filter bar on screen is a dead key: leave it to the browser's find.
    if (action.type === 'focusFilter' && !filter) return false;
    // Never leave a claimed chord to the browser (Ctrl+P prints), even when it does nothing now.
    e.preventDefault();
    if (modalOpen()) return true;
    const browse = useBrowse.getState();
    switch (action.type) {
        case 'quickOpen':
            if (!e.repeat) togglePalette('tables');
            break;
        case 'toggleSidebar':
            if (!e.repeat) useSidebarPrefs.getState().toggle();
            break;
        case 'focusSearch':
            if (useSidebarPrefs.getState().collapsed)
                useSidebarPrefs.getState().toggle();
            // The sidebar's input mounts on the next render when it was collapsed.
            requestAnimationFrame(() =>
                document.getElementById(SIDEBAR_SEARCH_ID)?.focus(),
            );
            break;
        case 'focusFilter':
            filter?.focus();
            break;
        case 'closeTab': {
            const current = browse.get(connectionId);
            if (current.activeId === 'records')
                browse.closeRecords(connectionId);
            else if (current.activeId !== 'universe')
                browse.closeTab(connectionId, current.activeId);
            break;
        }
        case 'review': {
            // Focus in the SQL editor is not focus in the table tab.
            if (e.repeat || document.activeElement?.closest('.monaco-editor'))
                break;
            const current = browse.get(connectionId);
            const tab = current.tabs.find((t) => t.id === current.activeId);
            if (tab?.kind !== 'table') break;
            // A draft in an open editor counts: it is staged before the preview is built.
            flushOpenEdits();
            const c = usePending.getState().count(connectionId, tab.table);
            if (c.inserted + c.updated + c.deleted > 0)
                useReview.getState().openReview(connectionId, tab.table);
            break;
        }
        case 'jumpTab':
            browse.activateIndex(connectionId, action.index);
            break;
        case 'cycleTab':
            browse.cycle(connectionId, action.dir);
            break;
    }
    return true;
}
