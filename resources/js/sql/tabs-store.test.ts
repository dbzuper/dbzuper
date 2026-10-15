import { beforeEach, describe, expect, it } from 'vitest';
import { useSqlTabs } from './tabs-store';

const s = () => useSqlTabs.getState();

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
});
