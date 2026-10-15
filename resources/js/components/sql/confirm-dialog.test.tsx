import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
    it('enables the destructive action only when the target is typed exactly', () => {
        const onResolve = vi.fn();
        render(
            <ConfirmDialog
                request={{
                    confirmation: {
                        statement_index: 0,
                        mode: 'typed',
                        kind: 'destructive',
                        keyword: 'DROP',
                        target: 'orders',
                    },
                    sql: 'drop table orders',
                }}
                onResolve={onResolve}
            />,
        );
        const run = screen.getByRole('button', { name: 'Run DROP' });
        expect(run).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Type orders to confirm'), {
            target: { value: 'Orders' },
        });
        expect(run).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Type orders to confirm'), {
            target: { value: 'orders' },
        });
        fireEvent.click(run);
        expect(onResolve).toHaveBeenCalledWith({
            confirmed: true,
            typed: 'orders',
        });
    });

    it('confirms simple writes and cancels', () => {
        const onResolve = vi.fn();
        render(
            <ConfirmDialog
                request={{
                    confirmation: {
                        statement_index: 0,
                        mode: 'confirm',
                        kind: 'write',
                        keyword: 'UPDATE',
                        target: null,
                    },
                    sql: 'update t set a=1 where id=1',
                }}
                onResolve={onResolve}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onResolve).toHaveBeenCalledWith(null);
    });
});
