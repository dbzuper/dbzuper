import { TABLE_FILTER_ID } from '@/components/browse/data-view';
import { SIDEBAR_SEARCH_ID } from '@/components/browse/table-sidebar';
import { modalOpen, togglePalette } from '@/lib/workspace-shortcuts';
import { useBrowse } from './browse-store';
import { browseKeyAction, isTypingTarget } from './shortcuts';
import { useSidebarPrefs } from './sidebar-prefs';

/** Handles one window keydown for the browse shortcuts. Returns true when it claimed the key. */
export function dispatchBrowseKey(
    e: KeyboardEvent,
    connectionId: number,
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
        case 'jumpTab':
            browse.activateIndex(connectionId, action.index);
            break;
        case 'cycleTab':
            browse.cycle(connectionId, action.dir);
            break;
    }
    return true;
}
