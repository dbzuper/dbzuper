import { render, screen } from '@testing-library/react';
import { Profiler, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
        const results = [result(5)];
        const onRender = vi.fn();
        let bump: () => void = () => {};
        function Parent() {
            const [, setN] = useState(0);
            bump = () => setN((n) => n + 1);
            return (
                <Profiler id="panel" onRender={onRender}>
                    <ResultPanel
                        results={results}
                        error={null}
                        running={false}
                    />
                </Profiler>
            );
        }
        render(<Parent />);
        expect(onRender).toHaveBeenCalledTimes(1);
        bump();
        bump();
        expect(onRender).toHaveBeenCalledTimes(1);
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
