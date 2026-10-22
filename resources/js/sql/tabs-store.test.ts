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

    describe('links to table tabs', () => {
        const link = (tabId: string) =>
            s().byConnection[1].tabs.find((t) => t.id === tabId)?.link;

        it('opens one linked editor tab per table tab and reuses it', () => {
            s().ensure(1);
            const id = s().openLinkedTab(1, 't:a', 'orders', 'orders', 'q1');
            const other = s().openTab(1, 'x');
            expect(s().byConnection[1].activeId).toBe(other);

            const again = s().openLinkedTab(1, 't:a', 'orders', 'orders', 'q2');

            expect(again).toBe(id);
            expect(s().byConnection[1].activeId).toBe(id);
            const tab = s().byConnection[1].tabs.find((t) => t.id === id);
            expect(tab).toMatchObject({
                title: 'orders',
                sql: 'q1',
                link: { browseTabId: 't:a', table: 'orders', syncedSql: 'q1' },
            });
            expect(s().findLinked(1, 't:a')?.id).toBe(id);
            expect(s().findLinked(2, 't:a')).toBeUndefined();
        });

        it('links two views of a table to two editor tabs', () => {
            const a = s().openLinkedTab(1, 't:a', 'orders', 'orders', 'q');
            const b = s().openLinkedTab(1, 't:b', 'orders', 'orders (2)', 'q');
            expect(a).not.toBe(b);
            expect(s().findLinked(1, 't:b')?.title).toBe('orders (2)');
        });

        it('sets and removes a link', () => {
            const id = s().openLinkedTab(1, 't:a', 'orders', 'orders', 'q');
            s().setLink(1, id, {
                browseTabId: 't:a',
                table: 'orders',
                syncedSql: 'q',
                stale: true,
            });
            expect(link(id)?.stale).toBe(true);
            s().setLink(1, id, undefined);
            expect(link(id)).toBeUndefined();
            expect(s().findLinked(1, 't:a')).toBeUndefined();
        });

        it('ends a closed link once the user edits the text', () => {
            const id = s().openLinkedTab(1, 't:a', 'orders', 'orders', 'q');
            s().setLink(1, id, { ...link(id)!, closed: true });
            s().setSql(1, id, 'q');
            expect(link(id)?.closed).toBe(true);
            s().setSql(1, id, 'q edited');
            expect(link(id)).toBeUndefined();
        });

        it('keeps a live link when the text is edited', () => {
            const id = s().openLinkedTab(1, 't:a', 'orders', 'orders', 'q');
            s().setSql(1, id, 'q edited');
            expect(link(id)?.syncedSql).toBe('q');
        });

        it('saves well-formed links and drops malformed or duplicate ones on restore', async () => {
            localStorage.setItem(
                KEY,
                JSON.stringify({
                    state: {
                        byConnection: {
                            1: {
                                tabs: [
                                    {
                                        id: 'a',
                                        title: 'orders',
                                        sql: 'q',
                                        link: {
                                            browseTabId: 't:a',
                                            table: 'orders',
                                            syncedSql: 'q',
                                            stale: true,
                                            extra: 1,
                                        },
                                    },
                                    {
                                        id: 'b',
                                        title: 'dup',
                                        sql: 'q',
                                        link: {
                                            browseTabId: 't:a',
                                            table: 'orders',
                                            syncedSql: 'q',
                                        },
                                    },
                                    {
                                        id: 'c',
                                        title: 'bad',
                                        sql: 'q',
                                        link: { browseTabId: 7 },
                                    },
                                ],
                                activeId: 'a',
                            },
                        },
                    },
                    version: 1,
                }),
            );
            await useSqlTabs.persist.rehydrate();
            const tabs = s().byConnection[1].tabs;
            expect(tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
            expect(tabs[0].link).toEqual({
                browseTabId: 't:a',
                table: 'orders',
                syncedSql: 'q',
                stale: true,
            });
            expect(tabs[1].link).toBeUndefined();
            expect(tabs[2].link).toBeUndefined();
        });
    });
});
