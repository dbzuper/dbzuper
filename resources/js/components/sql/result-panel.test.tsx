import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { StatementResultPayload } from '@/types/schema';
import { FALLBACK_MAX_ROWS, ResultPanel } from './result-panel';

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

    it('caps the interim table and says so', () => {
        render(
            <ResultPanel
                results={[result(FALLBACK_MAX_ROWS + 20)]}
                error={null}
                running={false}
            />,
        );
        expect(screen.getAllByRole('row')).toHaveLength(FALLBACK_MAX_ROWS + 1);
        expect(
            screen.getByText(`Showing first ${FALLBACK_MAX_ROWS} of 520 rows`),
        ).toBeInTheDocument();
    });
});
