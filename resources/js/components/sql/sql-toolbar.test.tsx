import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SqlToolbar } from './sql-toolbar';

describe('SqlToolbar', () => {
    it('explains that Cancel only stops waiting', () => {
        render(
            <SqlToolbar
                running
                maxRows={1000}
                onMaxRows={vi.fn()}
                onRun={vi.fn()}
                onRunAll={vi.fn()}
                onExplain={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute(
            'title',
            'Stops waiting — the server may still finish the statement',
        );
    });

    it('tells keyboard users how to leave the editor with Tab', () => {
        vi.stubGlobal('navigator', { platform: 'Win32' });
        render(
            <SqlToolbar
                running={false}
                maxRows={1000}
                onMaxRows={vi.fn()}
                onRun={vi.fn()}
                onRunAll={vi.fn()}
                onExplain={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByText('Ctrl+M: Tab moves focus')).toBeInTheDocument();
        vi.unstubAllGlobals();
    });
});
