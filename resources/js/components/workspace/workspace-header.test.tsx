import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkspaceHeader } from './workspace-header';

describe('WorkspaceHeader shortcut help', () => {
    it('discloses the shortcuts without a menu role', () => {
        render(
            <WorkspaceHeader
                connection={
                    {
                        id: 1,
                        name: 'x',
                        driver_label: 'MySQL',
                        read_only: false,
                        color: null,
                    } as never
                }
                loading={false}
                onRefresh={() => {}}
            />,
        );
        const btn = screen.getByRole('button', { name: 'Keyboard shortcuts' });
        expect(btn).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-expanded', 'true');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.getByText('Close tab')).toBeInTheDocument();
    });
});

describe('WorkspaceHeader snapshot age', () => {
    it('leaves the snapshot age to the status bar', () => {
        render(
            <WorkspaceHeader
                connection={
                    {
                        id: 1,
                        name: 'x',
                        driver_label: 'MySQL',
                        read_only: false,
                        color: null,
                    } as never
                }
                loading={false}
                onRefresh={() => {}}
            />,
        );
        expect(screen.queryByText(/Snapshot/)).toBeNull();
        expect(document.querySelector('time')).toBeNull();
    });
});
