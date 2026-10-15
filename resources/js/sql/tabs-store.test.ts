import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSqlTabs } from './tabs-store';

const s = () => useSqlTabs.getState();
const KEY = 'dbsuperb.sql-tabs';
const stored = () =>
    JSON.parse(localStorage.getItem(KEY) ?? '{}').state?.byConnection ?? {};
const tab = (id: string, sql: string) => ({
    tabs: [{ id, title: 'Query 1', sql }],
    activeId: id,
});

describe('sql tabs store', () => {
    beforeEach(() => useSqlTabs.setState({ byConnection: {} }));

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

        expect(stored()[1].tabs.map((t: { sql: string }) => t.sql)).toContain(
            'mine 1 edited',
        );
        expect(stored()[2]).toEqual(tab('other', 'theirs'));
    });

    it('reloads drafts when another browser tab saves them', async () => {
        s().openTab(1, 'mine');
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
});
