import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSqlTabs, type SqlLink, type SqlTab } from '@/sql/tabs-store';
import { LinkChip } from './link-chip';

const link: SqlLink = {
    browseTabId: 't:orders:2',
    table: 'orders',
    title: 'orders (2)',
    syncedSql: 'select 1',
};
const tabWith = (l?: SqlLink): SqlTab => ({
    id: 'e1',
    title: 'orders (2)',
    sql: 'select 1',
    link: l,
});
const chip = (l?: SqlLink) =>
    render(<LinkChip connectionId={1} tab={tabWith(l)} dialect="mysql" />);

beforeEach(() =>
    useSqlTabs.setState({
        byConnection: { 1: { tabs: [tabWith(link)], activeId: 'e1' } },
    }),
);

describe('LinkChip', () => {
    it('renders nothing for an unlinked tab', () => {
        const { container } = chip(undefined);
        expect(container).toBeEmptyDOMElement();
    });

    it('is a menu button naming the table tab', async () => {
        chip(link);
        const button = screen.getByRole('button', {
            name: 'Linked to orders (2)',
        });
        expect(button).toHaveAttribute('aria-haspopup', 'menu');
        fireEvent.keyDown(button, { key: 'Enter' });
        expect(
            await screen.findByRole('menuitem', { name: 'Copy to new tab' }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('menuitem', { name: 'Unlink' }),
        ).toBeInTheDocument();
    });

    it('when stale, states the change and offers Update SQL as a button', () => {
        chip({ ...link, stale: true });
        expect(screen.getByRole('status')).toHaveTextContent(
            'orders (2) changed',
        );
        expect(
            screen.getByRole('button', { name: 'Update SQL' }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Linked to/ })).toBeNull();
    });

    it('when closed, says so without a menu', () => {
        chip({ ...link, closed: true });
        expect(screen.getByRole('status')).toHaveTextContent(
            'Unlinked: orders (2) was closed',
        );
        expect(screen.queryByRole('button')).toBeNull();
    });
});
