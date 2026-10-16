import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSqlTabs, useSqlTabs } from './tabs-store';

const s = () => useSqlTabs.getState();
const KEY = 'dbsuperb.sql-tabs';
const stored = () =>
    JSON.parse(localStorage.getItem(KEY) ?? '{}').state?.byConnection ?? {};
const tab = (id: string, sql: string) => ({
    tabs: [{ id, title: 'Query 1', sql }],
    activeId: id,
});

describe('sql tabs store', () => {
    beforeEach(() => {
        flushSqlTabs();
        useSqlTabs.setState({ byConnection: {} });
        flushSqlTabs();
        localStorage.clear();
    });
    afterEach(() => vi.useRealTimers());

    it('ensures one empty tab per connection', () => {
        s().ensure(1);
        expect(s().byConnection[1].tabs).toHaveLength(1);
        s().ensure(1);
        expect(s().byConnection[1].tabs).toHaveLength(1);
    });

    it('opens, activates, edits and closes tabs', () => {
        s().ensure(1);
        const id = s().openTab(1, 'select 1', 'Path');
        expect(s().byConnection[1].activeId).toBe(id);
        s().setSql(1, id, 'select 2');
        expect(s().byConnection[1].tabs.find((t) => t.id === id)?.sql).toBe(
            'select 2',
        );
        s().closeTab(1, id);
        expect(s().byConnection[1].tabs.some((t) => t.id === id)).toBe(false);
        expect(s().byConnection[1].tabs.length).toBeGreaterThan(0);
    });

    it('keeps connections separate', () => {
        s().openTab(1, 'select 1');
        s().openTab(2, 'select 2');
        expect(s().byConnection[1].tabs.map((t) => t.sql)).not.toContain(
            'select 2',
        );
    });

    it('writes only the changed connection, keeping what another browser tab stored for the others', () => {
        s().openTab(1, 'mine 1');
        s().openTab(2, 'mine 2');
        flushSqlTabs();
        // Another browser tab saves its own drafts for connection 2.
        localStorage.setItem(
            KEY,
            JSON.stringify({
                state: {
                    byConnection: { ...stored(), 2: tab('other', 'theirs') },
                },
                version: 1,
            }),
        );

        s().setSql(1, s().byConnection[1].activeId, 'mine 1 edited');
        flushSqlTabs();

        expect(stored()[1].tabs.map((t: { sql: string }) => t.sql)).toContain(
            'mine 1 edited',
        );
        expect(stored()[2]).toEqual(tab('other', 'theirs'));
    });

    it('reloads drafts when another browser tab saves them', async () => {
        s().openTab(1, 'mine');
        flushSqlTabs();
        localStorage.setItem(
            KEY,
            JSON.stringify({
                state: { byConnection: { 1: tab('other', 'theirs') } },
                version: 1,
            }),
        );

        window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

        await vi.waitFor(() =>
            expect(s().byConnection[1]).toEqual(tab('other', 'theirs')),
        );
        window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
        expect(s().byConnection[1]).toEqual(tab('other', 'theirs'));
    });

    it('debounces persistence by 250 ms and flushes on pagehide', () => {
        vi.useFakeTimers();
        s().openTab(1, 'a');
        s().setSql(1, s().byConnection[1].activeId, 'ab');
        s().setSql(1, s().byConnection[1].activeId, 'abc');
        expect(localStorage.getItem(KEY)).toBeNull();

        vi.advanceTimersByTime(249);
        expect(localStorage.getItem(KEY)).toBeNull();
        vi.advanceTimersByTime(1);
        expect(stored()[1].tabs.map((t: { sql: string }) => t.sql)).toContain(
            'abc',
        );

        s().setSql(1, s().byConnection[1].activeId, 'abcd');
        window.dispatchEvent(new Event('pagehide'));
        expect(stored()[1].tabs.map((t: { sql: string }) => t.sql)).toContain(
            'abcd',
        );
    });

    it('prunes tabs of connections that no longer exist', () => {
        s().openTab(1, 'one');
        s().openTab(2, 'two');
        s().openTab(3, 'three');
        flushSqlTabs();

        s().prune([1, 3]);
        flushSqlTabs();

        expect(Object.keys(s().byConnection).sort()).toEqual(['1', '3']);
        expect(Object.keys(stored()).sort()).toEqual(['1', '3']);
    });

    it('names new tabs one past the highest Query N, never duplicating a title', () => {
        s().ensure(1);
        const second = s().openTab(1);
        s().openTab(1);
        s().closeTab(1, second);
        s().openTab(1);

        expect(s().byConnection[1].tabs.map((t) => t.title)).toEqual([
            'Query 1',
            'Query 3',
            'Query 4',
        ]);
        s().openTab(1, '', 'Custom');
        expect(s().byConnection[1].tabs.at(-1)?.title).toBe('Custom');
        expect(s().openTab(1)).toBeTruthy();
        expect(s().byConnection[1].tabs.at(-1)?.title).toBe('Query 5');
    });

    it('keeps the active tab of this window when another window save is rehydrated', async () => {
        s().ensure(1);
        const first = s().byConnection[1].activeId;
        const second = s().openTab(1, 'b');
        s().setActive(1, first);
        flushSqlTabs();
        // Another window saved the same tabs with the second one active.
        const saved = JSON.parse(localStorage.getItem(KEY) as string);
        saved.state.byConnection[1].activeId = second;
        saved.state.byConnection[1].tabs[1].sql = 'edited elsewhere';
        localStorage.setItem(KEY, JSON.stringify(saved));

        window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

        await vi.waitFor(() =>
            expect(s().byConnection[1].tabs[1].sql).toBe('edited elsewhere'),
        );
        expect(s().byConnection[1].activeId).toBe(first);
    });

    it('falls back to the stored active tab when the local one was removed elsewhere', async () => {
        s().ensure(1);
        const local = s().byConnection[1].activeId;
        flushSqlTabs();
        localStorage.setItem(
            KEY,
            JSON.stringify({
                state: { byConnection: { 1: tab('other', 'theirs') } },
                version: 1,
            }),
        );

        window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

        await vi.waitFor(() =>
            expect(s().byConnection[1].activeId).toBe('other'),
        );
        expect(local).not.toBe('other');
    });
});
