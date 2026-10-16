import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from '@/universe/store';
import { dispatchBrowseKey } from './key-dispatch';
import { useSidebarPrefs } from './sidebar-prefs';

const press = (init: KeyboardEventInit) =>
    new KeyboardEvent('keydown', { cancelable: true, ...init });

beforeEach(() => {
    useWorkspace.getState().reset();
    useSidebarPrefs.setState({ collapsed: false });
});
afterEach(() => {
    document.body.innerHTML = '';
});

describe('dispatchBrowseKey', () => {
    it('prevents Ctrl+P and Ctrl+B with the palette open but does nothing', () => {
        useWorkspace.getState().setPaletteOpen(true, 'all');
        const p = press({ key: 'p', ctrlKey: true });
        expect(dispatchBrowseKey(p, 1, true)).toBe(true);
        expect(p.defaultPrevented).toBe(true);
        expect(useWorkspace.getState().paletteMode).toBe('all');
        expect(useWorkspace.getState().paletteOpen).toBe(true);
        const b = press({ key: 'b', ctrlKey: true });
        dispatchBrowseKey(b, 1, true);
        expect(b.defaultPrevented).toBe(true);
        expect(useSidebarPrefs.getState().collapsed).toBe(false);
    });

    it('toggles the sidebar and ignores key repeat', () => {
        dispatchBrowseKey(press({ key: 'b', ctrlKey: true }), 1, true);
        expect(useSidebarPrefs.getState().collapsed).toBe(true);
        const rep = press({ key: 'b', ctrlKey: true, repeat: true });
        dispatchBrowseKey(rep, 1, true);
        expect(rep.defaultPrevented).toBe(true);
        expect(useSidebarPrefs.getState().collapsed).toBe(true);
    });

    it('leaves Ctrl+F to the browser without a filter element', () => {
        const e = press({ key: 'f', ctrlKey: true });
        expect(dispatchBrowseKey(e, 1, true)).toBe(false);
        expect(e.defaultPrevented).toBe(false);
    });

    it('focuses the filter on Ctrl+F when present and not typing', () => {
        document.body.innerHTML = '<select id="table-filter-bar"></select>';
        const e = press({ key: 'f', ctrlKey: true });
        expect(dispatchBrowseKey(e, 1, true)).toBe(true);
        expect(e.defaultPrevented).toBe(true);
        expect(document.activeElement?.id).toBe('table-filter-bar');
    });
});
