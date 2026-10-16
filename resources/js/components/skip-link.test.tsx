import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkipLink } from './skip-link';

describe('SkipLink', () => {
    it('links to the main landmark and is visible on focus only', () => {
        render(<SkipLink />);
        const link = screen.getByRole('link', { name: 'Skip to main content' });
        expect(link).toHaveAttribute('href', '#main');
        expect(link).toHaveClass('sr-only', 'focus:not-sr-only');
    });
});
