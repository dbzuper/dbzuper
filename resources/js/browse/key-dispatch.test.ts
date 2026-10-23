import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePending } from '@/editing/pending-store';
import { useReview } from '@/editing/review-store';
import { useWorkspace } from '@/universe/store';
import { flushBrowse, useBrowse } from './browse-store';
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

describe('Ctrl/Cmd+S on a table tab', () => {
    beforeEach(() => {
        flushBrowse();
        useBrowse.setState({ byConnection: {} });
        usePending.setState({ byTable: {}, errors: {} });
        useReview.setState({ open: null, nonce: 0 });
        useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
    });

    it('opens Review & commit when the table has pending changes', () => {
        usePending.getState().addRow(1, 'orders');
        const e = press({ key: 's', ctrlKey: true });
        expect(dispatchBrowseKey(e, 1, true)).toBe(true);
        expect(e.defaultPrevented).toBe(true);
        expect(useReview.getState().open).toEqual({
            connectionId: 1,
            table: 'orders',
        });
    });

    it('still keeps the browser from saving the page without pending changes', () => {
        const e = press({ key: 's', metaKey: true });
        expect(dispatchBrowseKey(e, 1, true)).toBe(true);
        expect(e.defaultPrevented).toBe(true);
        expect(useReview.getState().open).toBeNull();
    });

    it('does nothing while a modal is open or in the SQL editor', () => {
        usePending.getState().addRow(1, 'orders');
        document.body.innerHTML = '<div role="dialog"></div>';
        dispatchBrowseKey(press({ key: 's', ctrlKey: true }), 1, true);
        expect(useReview.getState().open).toBeNull();
        document.body.innerHTML =
            '<div class="monaco-editor"><textarea id="m"></textarea></div>';
        document.getElementById('m')!.focus();
        const e = press({ key: 's', ctrlKey: true });
        dispatchBrowseKey(e, 1, true);
        expect(e.defaultPrevented).toBe(true);
        expect(useReview.getState().open).toBeNull();
    });

    it('leaves Ctrl+S to the browser off a table tab', () => {
        const e = press({ key: 's', ctrlKey: true });
        expect(dispatchBrowseKey(e, 1, false)).toBe(false);
        expect(e.defaultPrevented).toBe(false);
    });
});
