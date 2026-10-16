import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    readGridLayout,
    readSidebarPrefs,
    SIDEBAR_DEFAULT,
    writeGridLayout,
    writeSidebarPrefs,
} from './local-prefs';

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('local prefs', () => {
    it('round-trips grid layouts per connection and table', () => {
        writeGridLayout(1, 'a.b', { widths: { id: 80 }, hidden: ['secret'] });
        expect(readGridLayout(1, 'a.b')).toEqual({
            widths: { id: 80 },
            hidden: ['secret'],
        });
        expect(readGridLayout(2, 'a.b')).toEqual({ widths: {}, hidden: [] });
    });

    it('clamps sidebar width and falls back on garbage', () => {
        writeSidebarPrefs({ width: 9999, collapsed: true });
        expect(readSidebarPrefs()).toEqual({ width: 480, collapsed: true });
        localStorage.setItem('dbsuperb.sidebar', '"nope"');
        expect(readSidebarPrefs()).toEqual({
            width: SIDEBAR_DEFAULT,
            collapsed: false,
        });
    });

    it('never throws when storage is blocked', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() =>
            writeGridLayout(1, 't', { widths: {}, hidden: [] }),
        ).not.toThrow();
        expect(readSidebarPrefs()).toEqual({
            width: SIDEBAR_DEFAULT,
            collapsed: false,
        });
    });
});
