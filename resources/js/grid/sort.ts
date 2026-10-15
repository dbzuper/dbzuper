import type { QueryCell } from '@/types/schema';

const INTEGER = /^-?\d+$/;

const numeric = (v: QueryCell) =>
    typeof v === 'number'
        ? v
        : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))
          ? Number(v)
          : null;

export function sortRows(
    rows: QueryCell[][],
    index: number,
    direction: 'ASC' | 'DESC',
): QueryCell[][] {
    const sign = direction === 'ASC' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const x = a[index];
        const y = b[index];
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        if (
            typeof x === 'string' &&
            typeof y === 'string' &&
            INTEGER.test(x) &&
            INTEGER.test(y)
        ) {
            const bx = BigInt(x);
            const by = BigInt(y);
            return bx === by ? 0 : (bx < by ? -1 : 1) * sign;
        }
        const nx = numeric(x);
        const ny = numeric(y);
        if (nx !== null && ny !== null) return (nx - ny) * sign;
        return (
            String(x).localeCompare(String(y), undefined, { numeric: true }) *
            sign
        );
    });
}
