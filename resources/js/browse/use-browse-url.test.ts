import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useBrowse } from './browse-store';
import { readTabParam, useBrowseUrl, withTabParam } from './use-browse-url';

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), toast) }));

describe('tab URL helpers', () => {
    it.each(['users', 'order items', 'a/b', '数据', 'a&b=c', 'x#y'])(
        'round-trips %s',
        (name) => {
            const url = withTabParam('/c/1?r=abc', name);
            expect(readTabParam(new URL(url, 'http://h').search)).toBe(name);
            expect(new URL(url, 'http://h').searchParams.get('r')).toBe('abc');
        },
    );
    it('removes the param', () => {
        expect(withTabParam('/c/1?tab=users&r=1', null)).toBe('/c/1?r=1');
        expect(readTabParam('?r=1')).toBeNull();
    });
    it('keeps the hash and replaces an existing param', () => {
        expect(withTabParam('/c/1?tab=a#h', 'b')).toBe('/c/1?tab=b#h');
        expect(withTabParam('/c/1', null)).toBe('/c/1');
    });
    it('treats an empty param as absent', () => {
        expect(readTabParam('?tab=')).toBeNull();
    });
});

describe('useBrowseUrl', () => {
    const snapshot = makeSnapshot([{ name: 'users' }, { name: 'order items' }]);
    const st = useBrowse.getState;

    beforeEach(() => {
        vi.clearAllMocks();
        useBrowse.setState({ byConnection: {} });
    });
    afterEach(() => window.history.replaceState(null, '', '/'));

    it('opens the table named by ?tab= once the snapshot is loaded', () => {
        window.history.replaceState(
            { page: 1 },
            '',
            '/c/1?tab=order+items&r=x',
        );
        const { rerender } = renderHook(({ snap }) => useBrowseUrl(1, snap), {
            initialProps: { snap: null as typeof snapshot | null },
        });
        expect(st().get(1).activeId).toBe('universe');
        rerender({ snap: snapshot });
        expect(st().get(1).activeId).toBe('t:order items');
        expect(st().get(1).tabs[1]).toMatchObject({ preview: false });
        expect(new URL(window.location.href).searchParams.get('tab')).toBe(
            'order items',
        );
        expect(new URL(window.location.href).searchParams.get('r')).toBe('x');
        expect(window.history.state).toEqual({ page: 1 });
    });

    it('drops an unknown table and says so', () => {
        window.history.replaceState(null, '', '/c/1?tab=gone&keep=1');
        renderHook(() => useBrowseUrl(1, snapshot));
        expect(toast.error).toHaveBeenCalledWith('Table not found: gone');
        expect(st().get(1).activeId).toBe('universe');
        expect(window.location.search).toBe('?keep=1');
    });

    it('lands on the Universe tab for an unknown table even when a table tab was active', () => {
        st().openTable(1, 'users', { mode: 'permanent' });
        window.history.replaceState(null, '', '/c/1?tab=gone');
        renderHook(() => useBrowseUrl(1, snapshot));
        expect(toast.error).toHaveBeenCalledWith('Table not found: gone');
        expect(st().get(1).activeId).toBe('universe');
        expect(
            st()
                .get(1)
                .tabs.some((t) => t.id === 't:users'),
        ).toBe(true);
        expect(window.location.search).toBe('');
    });

    it('follows the active tab', () => {
        window.history.replaceState(null, '', '/c/1?r=x');
        renderHook(() => useBrowseUrl(1, snapshot));
        act(() => void st().openTable(1, 'users'));
        expect(window.location.search).toBe('?r=x&tab=users');
        act(() => st().activate(1, 'universe'));
        expect(window.location.search).toBe('?r=x');
        act(() => st().showRecords(1, 'Records · users #1'));
        expect(window.location.search).toBe('?r=x');
    });

    it('ignores other connections', () => {
        window.history.replaceState(null, '', '/c/1');
        renderHook(() => useBrowseUrl(1, snapshot));
        act(() => void st().openTable(2, 'users'));
        expect(window.location.search).toBe('');
    });
});
