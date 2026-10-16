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
        expect(
            screen.getByText(
                'DROP removes data or objects on this connection and cannot be undone.',
            ),
        ).toBeInTheDocument();
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

    it.each([
        ['session', 'SET', 'SET changes session settings for this run.'],
        ['ddl', 'CREATE', 'CREATE changes the schema on this connection.'],
        ['write', 'INSERT', 'INSERT changes data on this connection.'],
    ])('describes %s statements', (kind, keyword, text) => {
        render(
            <ConfirmDialog
                request={{
                    confirmation: {
                        statement_index: 0,
                        mode: 'confirm',
                        kind,
                        keyword,
                        target: null,
                    },
                    sql: `${keyword} x`,
                }}
                onResolve={vi.fn()}
            />,
        );
        expect(screen.getByText(text)).toBeInTheDocument();
    });

    it('asks for all targets of a multi-object statement exactly as listed', () => {
        const onResolve = vi.fn();
        render(
            <ConfirmDialog
                request={{
                    confirmation: {
                        statement_index: 0,
                        mode: 'typed',
                        kind: 'destructive',
                        keyword: 'DROP',
                        target: 'a, b',
                    },
                    sql: 'drop table a, b',
                }}
                onResolve={onResolve}
            />,
        );
        expect(
            screen.getByText(/separated by a comma and a space/),
        ).toBeInTheDocument();
        const input = screen.getByLabelText('Type a, b to confirm');
        const run = screen.getByRole('button', { name: 'Run DROP' });
        fireEvent.change(input, { target: { value: 'a' } });
        expect(run).toBeDisabled();
        fireEvent.change(input, { target: { value: 'a,b' } });
        expect(run).toBeDisabled();
        fireEvent.change(input, { target: { value: 'a, b' } });
        fireEvent.click(run);
        expect(onResolve).toHaveBeenCalledWith({
            confirmed: true,
            typed: 'a, b',
        });
    });
});
