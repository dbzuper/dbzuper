import { describe, expect, it } from 'vitest';
import {
    DATE_OPS,
    addDays,
    dateKind,
    dateOpLabel,
    formatDateValue,
    isDateOnly,
    normalizeDateInput,
    quickRanges,
    rangeInOrder,
} from './date-filter';

const FORMAT = 'Use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS';
const ZONE = 'Time zones aren’t supported; enter the time as stored';

describe('dateKind', () => {
    it.each([
        ['date', 'date'],
        ['DATE', 'date'],
        [' date ', 'date'],
        ['datetime', 'datetime'],
        ['datetime2', 'datetime'],
        ['smalldatetime', 'datetime'],
        ['timestamp', 'datetime'],
        ['timestamp without time zone', 'datetime'],
        ['timestamptz', 'datetime'],
        ['datetimeoffset', 'datetime'],
        ['time', null],
        ['varchar', null],
        ['int', null],
    ])('%s -> %s', (type_name, expected) => {
        expect(dateKind({ type_name })).toBe(expected);
    });
});

describe('normalizeDateInput', () => {
    it('accepts a date', () => {
        expect(normalizeDateInput(' 2026-10-01 ', 'date')).toEqual({
            value: '2026-10-01',
        });
        expect(normalizeDateInput('2026-10-01', 'datetime')).toEqual({
            value: '2026-10-01',
        });
    });
    it('adds seconds and accepts T', () => {
        expect(normalizeDateInput('2026-10-01T14:00', 'datetime')).toEqual({
            value: '2026-10-01 14:00:00',
        });
        expect(normalizeDateInput('2026-10-01 14:05', 'datetime')).toEqual({
            value: '2026-10-01 14:05:00',
        });
        expect(normalizeDateInput('2026-10-01 14:05:06', 'datetime')).toEqual({
            value: '2026-10-01 14:05:06',
        });
        expect(
            normalizeDateInput('2026-10-01T14:05:06.25', 'datetime'),
        ).toEqual({
            value: '2026-10-01 14:05:06.25',
        });
    });
    it('rejects zones', () => {
        expect(normalizeDateInput('2026-10-01T14:00:00Z', 'datetime')).toEqual({
            error: ZONE,
        });
        expect(
            normalizeDateInput('2026-10-01 14:00+08:00', 'datetime'),
        ).toEqual({ error: ZONE });
        expect(
            normalizeDateInput('2026-10-01 14:00:00-05:00', 'datetime'),
        ).toEqual({ error: ZONE });
    });
    it('rejects impossible and malformed input', () => {
        const bad = [
            '2026-02-30',
            '2026-13-01',
            '2026-10-01 24:00:00',
            '2026-10-01 10:60',
            '',
            'abc',
            '2026-1-1',
            '2026-10-01 10:00:00.1234567',
        ];
        for (const text of bad) {
            expect(normalizeDateInput(text, 'datetime')).toEqual({
                error: FORMAT,
            });
        }
        expect(normalizeDateInput('2028-02-29', 'date')).toEqual({
            value: '2028-02-29',
        });
        expect(normalizeDateInput('2027-02-29', 'date')).toEqual({
            error: FORMAT,
        });
    });
    it('rejects a time on a date kind', () => {
        expect(normalizeDateInput('2026-10-01 10:00', 'date')).toEqual({
            error: FORMAT,
        });
    });
});

describe('isDateOnly / addDays', () => {
    it('detects date-only', () => {
        expect(isDateOnly('2026-10-01')).toBe(true);
        expect(isDateOnly('2026-10-01 00:00:00')).toBe(false);
    });
    it('does calendar arithmetic', () => {
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
        expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
        expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
        expect(addDays('2026-10-01 14:00:00', 1)).toBe('2026-10-02');
        expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    });
});

describe('formatDateValue', () => {
    it('formats', () => {
        expect(formatDateValue('2026-10-01')).toBe('1 Oct 2026');
        expect(formatDateValue('2026-10-01 14:00:00')).toBe('1 Oct 2026 14:00');
        expect(formatDateValue('2026-10-01 14:00:05')).toBe(
            '1 Oct 2026 14:00:05',
        );
    });
});

describe('quickRanges', () => {
    const find = (r: ReturnType<typeof quickRanges>, label: string) =>
        r.find((x) => x.label === label);
    it('lists in order', () => {
        expect(quickRanges(new Date(2026, 9, 23)).map((r) => r.label)).toEqual([
            'Today',
            'Yesterday',
            'Last 7 days',
            'Last 30 days',
            'This month',
            'Last month',
        ]);
    });
    it('computes ranges', () => {
        const r = quickRanges(new Date(2026, 9, 23));
        expect(find(r, 'Today')).toMatchObject({
            from: '2026-10-23',
            to: '2026-10-23',
        });
        expect(find(r, 'Yesterday')).toMatchObject({
            from: '2026-10-22',
            to: '2026-10-22',
        });
        expect(find(r, 'Last 7 days')).toMatchObject({
            from: '2026-10-17',
            to: '2026-10-23',
        });
        expect(find(r, 'Last 30 days')).toMatchObject({
            from: '2026-09-24',
            to: '2026-10-23',
        });
        expect(find(r, 'This month')).toMatchObject({
            from: '2026-10-01',
            to: '2026-10-31',
        });
        expect(find(r, 'Last month')).toMatchObject({
            from: '2026-09-01',
            to: '2026-09-30',
        });
    });
    it('crosses the year boundary', () => {
        const r = quickRanges(new Date(2026, 0, 5));
        expect(find(r, 'Last month')).toMatchObject({
            from: '2025-12-01',
            to: '2025-12-31',
        });
        expect(find(r, 'Yesterday')).toMatchObject({ from: '2026-01-04' });
    });
    it('handles a leap February', () => {
        const r = quickRanges(new Date(2028, 2, 10));
        expect(find(r, 'Last month')).toMatchObject({
            from: '2028-02-01',
            to: '2028-02-29',
        });
    });
});

describe('dateOpLabel / DATE_OPS', () => {
    it('relabels lt on date columns', () => {
        expect(dateOpLabel('lt', 'date')).toBe('before');
        expect(dateOpLabel('lt', 'datetime')).toBe('before');
        expect(dateOpLabel('lt', null)).toBe('<');
        expect(dateOpLabel('eq', 'date')).toBe('equals');
        expect(dateOpLabel('between', 'date')).toBe('between');
    });
    it('orders ops', () => {
        expect(DATE_OPS).toEqual([
            'on',
            'between',
            'lt',
            'after',
            'eq',
            'neq',
            'is_null',
            'is_not_null',
        ]);
    });
});

describe('rangeInOrder', () => {
    it.each([
        ['2026-10-15 10:00:00', '2026-10-15', true],
        ['2026-10-15 10:00:00.5', '2026-10-15 10:00:00.50', true],
        ['2026-10-15', '2026-10-14 23:59:59', false],
        ['2026-10-16', '2026-10-15', false],
        ['2026-10-15', '2026-10-15', true],
        ['2026-10-15 10:00:01', '2026-10-15 10:00:00', false],
        ['2026-10-15 10:00:00', '2026-10-15 10:00:00', true],
        ['2026-10-15 10:00:00.6', '2026-10-15 10:00:00.5', false],
        ['2026-10-31', '2026-10-31', true],
        ['2026-11-01', '2026-10-31', false],
    ])('%s .. %s -> %s', (a, b, expected) => {
        expect(rangeInOrder(a, b)).toBe(expected);
    });
});
