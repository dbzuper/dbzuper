import type { RowCountSchema } from '@/types/schema';

const compact = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
});
const full = new Intl.NumberFormat('en');

export function formatRowCount(rc: RowCountSchema): string {
    if (rc.count === null || rc.kind === 'unknown') return '—';
    if (rc.kind === 'estimate') return `~${compact.format(rc.count)}`;
    if (rc.kind === 'at_least') return `${full.format(rc.count)}+`;
    return full.format(rc.count);
}
