import { describe, expect, it } from 'vitest';
import { formatRowCount } from './format';

describe('formatRowCount', () => {
    it.each([
        [{ count: 42, kind: 'exact' }, '42'],
        [{ count: 1234567, kind: 'exact' }, '1,234,567'],
        [{ count: 1234, kind: 'estimate' }, '~1.2K'],
        [{ count: 5_600_000, kind: 'estimate' }, '~5.6M'],
        [{ count: 100000, kind: 'at_least' }, '100,000+'],
        [{ count: null, kind: 'unknown' }, '—'],
    ] as const)('formats %o as %s', (input, expected) => {
        expect(formatRowCount(input)).toBe(expected);
    });
});
