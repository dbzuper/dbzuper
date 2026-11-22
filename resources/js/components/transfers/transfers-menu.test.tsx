import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConnectionSummary } from '@/types/connection';
import { useWorkspace } from '@/universe/store';
import { TransfersMenu } from './transfers-menu';

const connection = (readOnly: boolean) =>
    ({ id: 5, ref: '5', read_only: readOnly }) as ConnectionSummary;

/** Radix menus open on pointerdown (or a key), not on click. */
const openMenu = () =>
    fireEvent.keyDown(
        screen.getByRole('button', { name: 'Backup & restore' }),
        { key: 'Enter' },
    );

beforeEach(() => useWorkspace.getState().reset());

describe('TransfersMenu', () => {
    it('opens the backup and restore dialogs', () => {
        render(<TransfersMenu connection={connection(false)} />);
        openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Back up…' }));
        expect(useWorkspace.getState().transferDialog).toBe('backup');
        openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Restore…' }));
        expect(useWorkspace.getState().transferDialog).toBe('restore');
    });

    it('disables restore on a read-only connection and says why', () => {
        render(<TransfersMenu connection={connection(true)} />);
        openMenu();
        const restore = screen.getByRole('menuitem', { name: /Restore…/ });
        expect(restore).toHaveAttribute('aria-disabled', 'true');
        expect(restore).toHaveAccessibleDescription(
            'This connection is read-only',
        );
        fireEvent.click(restore);
        expect(useWorkspace.getState().transferDialog).toBeNull();
    });
});
