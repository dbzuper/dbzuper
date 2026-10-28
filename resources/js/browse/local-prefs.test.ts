import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    readGridLayout,
    readGroupingEnabled,
    readGroupPrefs,
    readSidebarPrefs,
    SIDEBAR_DEFAULT,
    writeGridLayout,
    writeGroupingEnabled,
    writeGroupPrefs,
    writeSidebarPrefs,
} from './local-prefs';

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('local prefs', () => {
    it('round-trips grid layouts per connection and table', () => {
        writeGridLayout('1', 'a.b', { widths: { id: 80 }, hidden: ['secret'] });
        expect(readGridLayout('1', 'a.b')).toEqual({
            widths: { id: 80 },
            hidden: ['secret'],
        });
        expect(readGridLayout('2', 'a.b')).toEqual({ widths: {}, hidden: [] });
    });

    it('clamps sidebar width and falls back on garbage', () => {
        writeSidebarPrefs({ width: 9999, collapsed: true });
        expect(readSidebarPrefs()).toEqual({ width: 480, collapsed: true });
        localStorage.setItem('dbzuper.sidebar', '"nope"');
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
            writeGridLayout('1', 't', { widths: {}, hidden: [] }),
        ).not.toThrow();
        expect(readSidebarPrefs()).toEqual({
            width: SIDEBAR_DEFAULT,
            collapsed: false,
        });
    });
});

describe('group prefs', () => {
    it('round-trips open groups per connection', () => {
        writeGroupPrefs('1', { open: ['courier_'] });
        expect(readGroupPrefs('1')).toEqual({ open: ['courier_'] });
        expect(readGroupPrefs('2')).toEqual({ open: [] });
    });

    it('reads corrupt JSON as nothing open', () => {
        localStorage.setItem('dbzuper.sidebar-groups', '{nope');
        expect(readGroupPrefs('1')).toEqual({ open: [] });
    });

    it('defaults grouping to on and persists the toggle', () => {
        expect(readGroupingEnabled()).toBe(true);
        writeGroupingEnabled(false);
        expect(readGroupingEnabled()).toBe(false);
    });
});
