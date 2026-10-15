import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FILTER_OPS, type FilterOp, type RowFilter } from '@/lib/workspace-api';

const opLabel = (op: FilterOp) =>
    FILTER_OPS.find((o) => o.value === op)?.label ?? op;

const fieldClass =
    'h-7 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';

type Props = {
    columns: string[];
    filters: RowFilter[];
    onChange: (filters: RowFilter[]) => void;
};

export function FilterBar({ columns, filters, onChange }: Props) {
    const [column, setColumn] = useState('');
    const [op, setOp] = useState<FilterOp>('eq');
    const [value, setValue] = useState('');

    const needsValue = FILTER_OPS.find((o) => o.value === op)?.needsValue;
    const selected = columns.includes(column) ? column : (columns[0] ?? '');
    const canAdd = selected !== '' && (!needsValue || value !== '');

    const add = () => {
        if (!canAdd) return;
        onChange([
            ...filters,
            needsValue
                ? { column: selected, op, value }
                : { column: selected, op },
        ]);
        setValue('');
    };

    return (
        <div className="flex flex-col gap-2 border-b px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
                <select
                    aria-label="Filter column"
                    className={fieldClass}
                    value={selected}
                    onChange={(e) => setColumn(e.target.value)}
                >
                    {columns.map((c) => (
                        <option key={c} value={c}>
                            {c}
                        </option>
                    ))}
                </select>
                <select
                    aria-label="Filter operator"
                    className={fieldClass}
                    value={op}
                    onChange={(e) => setOp(e.target.value as FilterOp)}
                >
                    {FILTER_OPS.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
                {needsValue && (
                    <input
                        aria-label="Filter value"
                        className={`${fieldClass} w-36`}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                add();
                            }
                        }}
                    />
                )}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canAdd}
                    onClick={add}
                >
                    Add filter
                </Button>
            </div>
            {filters.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                    {filters.map((f, i) => {
                        const text = `${f.column} ${opLabel(f.op)}${f.value ? ' ' + f.value : ''}`;
                        return (
                            <li
                                key={`${f.column}:${f.op}:${f.value ?? ''}:${i}`}
                                className="flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 font-mono text-[11px]"
                            >
                                <span>{text}</span>
                                <button
                                    type="button"
                                    aria-label={`Remove filter ${text}`}
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                        onChange(
                                            filters.filter((_, j) => j !== i),
                                        )
                                    }
                                >
                                    <X className="size-3" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
