import { describe, expect, it } from 'vitest';
import { changedSize } from './container-size';

describe('changedSize', () => {
    it('reports the rounded size when it differs from the previous one', () => {
        expect(changedSize({ width: 1000, height: 600 }, 580.4, 600)).toEqual({
            width: 580,
            height: 600,
        });
    });

    it('returns null when nothing changed', () => {
        expect(changedSize({ width: 580, height: 600 }, 580, 600)).toBeNull();
    });

    it('ignores sub-pixel jitter that rounds to the same size', () => {
        expect(
            changedSize({ width: 580, height: 600 }, 580.3, 599.6),
        ).toBeNull();
    });

    it('detects a height-only change', () => {
        expect(changedSize({ width: 580, height: 600 }, 580, 500)).toEqual({
            width: 580,
            height: 500,
        });
    });

    it('treats a missing previous size as changed', () => {
        expect(changedSize(null, 580, 600)).toEqual({
            width: 580,
            height: 600,
        });
    });
});
