import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RadarLoader, RadarSweep } from '@/components/radar';

describe('RadarLoader', () => {
    it('announces its text as a status, with the radar beside it', () => {
        render(<RadarLoader>Loading schema…</RadarLoader>);

        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Loading schema…');
        expect(screen.getByText('Loading schema…')).toBeInTheDocument();
        expect(status.querySelector('svg')).toHaveAttribute(
            'aria-hidden',
            'true',
        );
    });
});

describe('RadarSweep', () => {
    it('draws a turning sweep and an orange blip', () => {
        const { container } = render(<RadarSweep />);

        expect(container.querySelector('.radar-sweep')).not.toBeNull();
        expect(container.querySelector('.radar-blip')).toHaveClass(
            'fill-logo-dot',
        );
    });
});
