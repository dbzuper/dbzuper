import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from './__fixtures__/snapshot';

// The model kit chunk is held back until the test releases it, like a cold network load.
const gate = vi.hoisted(() => {
    let release: () => void = () => {};
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { promise, release: () => release() };
});
vi.mock('./model-kit', async (importOriginal) => {
    await gate.promise;
    return importOriginal();
});

import { useUniverseModel } from './use-universe-model';

describe('useUniverseModel on a cold visit', () => {
    it('reports the layout state while the model kit loads', async () => {
        const snapshot = makeSnapshot([{ name: 'a' }, { name: 'b' }], []);
        const { result } = renderHook(() =>
            useUniverseModel(snapshot, [], vi.fn()),
        );
        expect(result.current.status).toBe('layout');
        expect(result.current.model).toBeNull();
        gate.release();
        await waitFor(() => expect(result.current.status).toBe('ready'));
    });
});
