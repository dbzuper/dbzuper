import type { QueryCell } from '@/types/schema';

export type RecordKeyValues = Record<string, string | number>;

export interface RelationshipSummary {
    id: string;
    direction: 'out' | 'in';
    table: string;
    columns: string[];
    other_columns: string[];
    inferred: boolean;
    available: boolean;
    count: { value: number; capped: boolean } | null;
}

export interface RecordPayload {
    table: string;
    key: RecordKeyValues;
    columns: { name: string; type: string }[];
    values: QueryCell[];
    relationships: RelationshipSummary[];
}

export interface RelatedPayload {
    table: string;
    columns: { name: string; type: string }[];
    primary_key: string[];
    rows: { key: RecordKeyValues; values: QueryCell[] }[];
    next_cursor: string | null;
}
