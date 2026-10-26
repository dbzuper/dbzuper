import { describe, expect, it } from 'vitest';
import {
    shortVersion,
    formatBytes,
    formatConnectionTarget,
    formatRowCount,
    formatSnapshotAge,
} from './format';
import type { ConnectionSummary } from '@/types/connection';

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

describe('formatBytes', () => {
    it.each([
        [null, '—'],
        [0, '0 B'],
        [1536, '1.5 KB'],
        [5 * 1024 * 1024, '5 MB'],
    ] as const)('formats %s as %s', (input, expected) => {
        expect(formatBytes(input)).toBe(expected);
    });
});

describe('formatConnectionTarget', () => {
    const conn = (c: Partial<ConnectionSummary>) =>
        ({
            driver: 'mysql',
            host: '127.0.0.1',
            port: 3307,
            database: 'shop',
            ...c,
        }) as ConnectionSummary;

    it('reads host:port/database for a server', () => {
        expect(formatConnectionTarget(conn({}))).toBe('127.0.0.1:3307/shop');
    });

    it('reads the file name for SQLite', () => {
        expect(
            formatConnectionTarget(
                conn({
                    driver: 'sqlite',
                    host: null,
                    port: null,
                    database: '/data/app.sqlite',
                }),
            ),
        ).toBe('app.sqlite');
        expect(
            formatConnectionTarget(
                conn({
                    driver: 'sqlite',
                    host: null,
                    database: 'C:\\db\\x.db',
                }),
            ),
        ).toBe('x.db');
    });

    it('reads just the database without a host', () => {
        expect(formatConnectionTarget(conn({ host: null }))).toBe('shop');
    });

    it('leaves the port out when there is none', () => {
        expect(formatConnectionTarget(conn({ port: null }))).toBe(
            '127.0.0.1/shop',
        );
    });
});

describe('shortVersion', () => {
    it('keeps the release number of each engine', () => {
        expect(shortVersion('8.4.0')).toBe('8.4.0');
        expect(shortVersion('11.4.2-MariaDB-ubu2404')).toBe('11.4.2');
        expect(shortVersion('18.4 (Debian 18.4-1.pgdg12+1)')).toBe('18.4');
        expect(shortVersion('3.46.1')).toBe('3.46.1');
    });

    it('leaves an unrecognised version alone', () => {
        expect(shortVersion('dev build')).toBe('dev build');
    });
});
