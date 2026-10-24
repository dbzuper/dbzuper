import { beforeEach, describe, expect, it } from 'vitest';
import { useTabStatus } from './status-store';

beforeEach(() => useTabStatus.setState({ byTab: {} }));

describe('useTabStatus', () => {
    it('keeps the published status of a tab', () => {
        const status = {
            from: 1,
            to: 50,
            total: { count: 120, exact: true },
            ms: 12,
        };
        useTabStatus.getState().publish('t1', status);
        expect(useTabStatus.getState().byTab.t1).toEqual(status);
    });

    it('forgets a cleared tab, leaving the others', () => {
        const s = { from: 0, to: 0, total: null, ms: 3 };
        useTabStatus.getState().publish('t1', s);
        useTabStatus.getState().publish('t2', s);
        useTabStatus.getState().clear('t1');
        expect(useTabStatus.getState().byTab).toEqual({ t2: s });
    });
});
