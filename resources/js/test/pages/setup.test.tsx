import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

const post = vi.fn();

// useForm backed by component state, so the form re-renders as fields change.
vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
    useForm: <T extends Record<string, unknown>>(initial: T) => {
        const [data, setDataState] = useState(initial);
        return {
            data,
            setData: (key: keyof T, value: unknown) =>
                setDataState((d) => ({ ...d, [key]: value })),
            errors: {},
            processing: false,
            post,
            reset: vi.fn(),
        };
    },
}));

vi.mock('@/layouts/auth-layout', () => ({
    default: ({ children }: { children: React.ReactNode }) => children,
}));

import Setup from '@/pages/setup';

describe('setup screen', () => {
    it('asks for the setup code first and says where to find it', () => {
        render(<Setup />);
        const code = screen.getByLabelText('Setup code');

        expect(screen.getAllByRole('textbox')[0]).toBe(code);
        expect(code).toBeRequired();
        const hint = document.getElementById(
            code.getAttribute('aria-describedby') ?? '',
        );
        expect(hint?.textContent).toContain('docker compose logs');
        expect(hint?.textContent).toContain('php artisan dbzuper:setup-code');
    });

    it('sends the code with the administrator', () => {
        render(<Setup />);
        fireEvent.change(screen.getByLabelText('Setup code'), {
            target: { value: 'k7qm 4xrt 9pwd' },
        });
        fireEvent.submit(
            screen.getByRole('button', { name: 'Create administrator' }),
        );

        expect(post).toHaveBeenCalledWith('/setup', expect.anything());
    });
});
