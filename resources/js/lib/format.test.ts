import { describe, expect, it } from 'vitest';
import { formatRowCount, formatSnapshotAge } from './format';

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

describe('formatSnapshotAge', () => {
    const now = new Date('2026-10-15T12:00:00Z');

    it.each([
        ['2026-10-15T11:59:40Z', 'just now'],
        ['2026-10-15T11:55:00Z', '5 minutes ago'],
        ['2026-10-15T09:00:00Z', '3 hours ago'],
        ['2026-10-13T12:00:00Z', '2 days ago'],
        ['2026-09-01T08:30:00Z', '2026-09-01 08:30 UTC'],
    ])('formats %s as %s', (iso, expected) => {
        expect(formatSnapshotAge(iso, now)).toBe(expected);
    });

    it('returns the input when it is not a date', () => {
        expect(formatSnapshotAge('nonsense', now)).toBe('nonsense');
    });
});
