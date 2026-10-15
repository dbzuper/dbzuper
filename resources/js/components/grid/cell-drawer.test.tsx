import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CellDrawer, TRUNCATION_LIMIT } from './cell-drawer';

const column = { name: 'body', type: 'text', table: null };

describe('CellDrawer', () => {
    it('notes truncation for a 4,000 character value ending in an ellipsis', () => {
        render(
            <CellDrawer
                state={{ column, value: 'a'.repeat(TRUNCATION_LIMIT) + '…' }}
                onClose={() => {}}
            />,
        );
        expect(
            screen.getByText('Value truncated at 4,000 characters'),
        ).toBeInTheDocument();
    });

    it('counts code points, so an emoji value cut by the server still shows the note', () => {
        render(
            <CellDrawer
                state={{ column, value: '🚀'.repeat(TRUNCATION_LIMIT) + '…' }}
                onClose={() => {}}
            />,
        );
        expect(
            screen.getByText('Value truncated at 4,000 characters'),
        ).toBeInTheDocument();
    });

    it('shows no note for a short emoji value', () => {
        render(
            <CellDrawer state={{ column, value: '🚀…' }} onClose={() => {}} />,
        );
        expect(screen.queryByText(/truncated/)).toBeNull();
    });

    it('shows no note for ordinary values', () => {
        render(
            <CellDrawer state={{ column, value: 'hi…' }} onClose={() => {}} />,
        );
        expect(screen.queryByText(/truncated/)).toBeNull();
    });
});
