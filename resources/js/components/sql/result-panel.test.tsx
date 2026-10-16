import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useRecords } from '@/records/records-store';
import type { StatementResultPayload } from '@/types/schema';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { ResultPanel } from './result-panel';

const result = (rows: number): StatementResultPayload => ({
    sql: 'select n from t',
    kind: 'read',
    columns: [{ name: 'n', type: null, table: null }],
    rows: Array.from({ length: rows }, (_, i) => [i]),
    truncated: false,
    affected: null,
    duration_ms: 1,
    error: null,
});

describe('ResultPanel', () => {
    it('does not re-render when the parent re-renders with the same props', () => {
        // ResultPanel reads `columns` on every render, so the read count shows whether it re-rendered.
        let reads = 0;
        const base = result(5);
        const counted = {
            ...base,
            get columns() {
                reads++;
                return base.columns;
            },
        } as StatementResultPayload;
        const results = [counted];
        let bump: () => void = () => {};
        function Parent() {
            const [, setN] = useState(0);
            bump = () => setN((n) => n + 1);
            return (
                <ResultPanel results={results} error={null} running={false} />
            );
        }
        render(<Parent />);
        const afterMount = reads;
        expect(afterMount).toBeGreaterThan(0);
        act(() => bump());
        act(() => bump());
        expect(reads).toBe(afterMount);
    });

    it('renders results in the grid without capping rows and keeps the server truncation note', () => {
        render(
            <ResultPanel
                results={[{ ...result(2000), truncated: true }]}
                error={null}
                running={false}
            />,
        );
        expect(
            screen.getByRole('columnheader', { name: 'n' }),
        ).toBeInTheDocument();
        expect(screen.queryByText(/Showing first 500/)).toBeNull();
        expect(
            screen.getByText('Showing first 2,000 rows (limit reached)'),
        ).toBeInTheDocument();
    });

    it('downloads CSV with a UTF-8 BOM and revokes the URL afterwards', async () => {
        let blob: Blob | undefined;
        const create = vi.fn((b: Blob) => ((blob = b), 'blob:x'));
        const revoke = vi.fn();
        vi.stubGlobal(
            'URL',
            Object.assign(URL, {
                createObjectURL: create,
                revokeObjectURL: revoke,
            }),
        );
        vi.useFakeTimers();
        try {
            render(
                <ResultPanel
                    results={[result(2)]}
                    error={null}
                    running={false}
                />,
            );
            fireEvent.click(
                screen.getByRole('button', { name: 'Download CSV' }),
            );
            expect(revoke).not.toHaveBeenCalled();
            vi.runAllTimers();
            expect(revoke).toHaveBeenCalledWith('blob:x');
        } finally {
            vi.useRealTimers();
            vi.unstubAllGlobals();
        }
        const bytes = await new Promise<Uint8Array>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
                resolve(new Uint8Array(reader.result as ArrayBuffer));
            reader.readAsArrayBuffer(blob!);
        });
        expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    });

    it('offers Copy as and Download CSV for row results', () => {
        render(
            <ResultPanel results={[result(2)]} error={null} running={false} />,
        );
        expect(
            screen.getByRole('button', { name: 'Copy as' }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Download CSV' }),
        ).toBeInTheDocument();
    });

    it('shows a row count and runtime status line for every result with columns', () => {
        render(
            <ResultPanel
                results={[{ ...result(1234), duration_ms: 42 }]}
                error={null}
                running={false}
            />,
        );
        expect(screen.getByText('1,234 rows · 42 ms')).toBeInTheDocument();
        expect(screen.queryByText(/limit reached/)).toBeNull();
    });

    it('warns when a run ended inside a transaction that was rolled back', () => {
        render(
            <ResultPanel
                results={[result(1)]}
                error={null}
                running={false}
                openTransactionRolledBack
            />,
        );
        expect(
            screen.getByText(
                'This run ended inside an open transaction; it was rolled back. Transactions only span a single Run all.',
            ),
        ).toBeInTheDocument();
    });

    it('warns when a run consists only of transaction-control statements', () => {
        const commit: StatementResultPayload = {
            ...result(0),
            sql: 'commit',
            kind: 'transaction',
            columns: [],
            rows: [],
            affected: 0,
        };
        const { rerender } = render(
            <ResultPanel results={[commit]} error={null} running={false} />,
        );
        expect(
            screen.getByText(
                'Transactions only span a single Run all — run BEGIN … COMMIT together.',
            ),
        ).toBeInTheDocument();

        rerender(
            <ResultPanel
                results={[commit, result(1)]}
                error={null}
                running={false}
            />,
        );
        expect(screen.queryByText(/Transactions only span/)).toBeNull();
    });

    it('opens the record of a result row of an explorable table', () => {
        const open = vi.fn();
        useRecords.setState({ open });
        render(
            <ResultPanel
                results={[
                    {
                        ...result(2),
                        columns: [{ name: 'id', type: 'int', table: 'orders' }],
                        rows: [[7], [8]],
                    },
                ]}
                error={null}
                running={false}
                snapshot={makeSnapshot([{ name: 'orders' }])}
            />,
        );
        fireEvent.click(
            screen.getAllByRole('button', { name: 'Open record' })[1],
        );
        expect(open).toHaveBeenCalledWith('orders', { id: 8 });
    });

    it('selects the tab of the statement that failed', () => {
        const failed: StatementResultPayload = {
            ...result(0),
            sql: 'select boom',
            columns: [],
            error: {
                kind: 'unknown',
                message: 'boom happened',
                sqlstate: null,
                reason: null,
            },
        };
        render(
            <ResultPanel
                results={[result(1), result(1), failed]}
                error={null}
                running={false}
            />,
        );
        expect(screen.getByRole('tab', { name: /#3/ })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByRole('alert')).toHaveTextContent('boom happened');
        fireEvent.click(screen.getByRole('tab', { name: /#1/ }));
        expect(screen.getByRole('tab', { name: /#1/ })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    it('shows multi-line error messages (PostgreSQL DETAIL/HINT) on their own lines', () => {
        render(
            <ResultPanel
                results={[]}
                error={{
                    kind: 'unknown',
                    message:
                        'duplicate key\nDETAIL: Key (id)=(1) already exists.',
                    sqlstate: null,
                    reason: null,
                }}
                running={false}
            />,
        );
        expect(screen.getByText(/duplicate key/)).toHaveClass(
            'whitespace-pre-line',
        );
    });

    it('keeps earlier results next to the Cancelled. notice', () => {
        render(
            <ResultPanel
                results={[result(2)]}
                error={null}
                running={false}
                cancelled
            />,
        );
        expect(screen.getByText('Cancelled.')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /#1/ })).toBeInTheDocument();
    });

    it('says Cancelled. after a cancelled run, and Running… takes precedence while running', () => {
        const { rerender } = render(
            <ResultPanel results={[]} error={null} running={false} cancelled />,
        );
        expect(screen.getByText('Cancelled.')).toBeInTheDocument();
        rerender(<ResultPanel results={[]} error={null} running cancelled />);
        expect(screen.getByText('Running…')).toBeInTheDocument();
        expect(screen.queryByText('Cancelled.')).toBeNull();
    });
});
