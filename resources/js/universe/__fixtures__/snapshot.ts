import type {
    RelationshipSchema,
    SchemaSnapshot,
    TableSchema,
} from '@/types/schema';

type TableSeed = Partial<TableSchema> & { name: string };
type RelSeed = Partial<RelationshipSchema> & {
    from_table: string;
    to_table: string;
};

export function makeTable(seed: TableSeed): TableSchema {
    return {
        kind: 'table',
        row_count: { count: 10, kind: 'exact' },
        size_bytes: null,
        primary_key: ['id'],
        columns: [
            {
                name: 'id',
                type: 'integer',
                type_name: 'integer',
                nullable: false,
                default: null,
                auto_increment: true,
                comment: null,
            },
        ],
        indexes: [],
        ...seed,
    };
}

export function makeRelationship(seed: RelSeed): RelationshipSchema {
    const fromColumns = seed.from_columns ?? [`${seed.to_table}_id`];
    const toColumns = seed.to_columns ?? ['id'];
    const inferred = seed.inferred ?? false;
    return {
        id:
            seed.id ??
            `${inferred ? 'inferred' : 'fk'}:${seed.from_table}(${fromColumns.join(',')})->${seed.to_table}(${toColumns.join(',')})`,
        from_columns: fromColumns,
        to_columns: toColumns,
        inferred,
        confidence: seed.confidence ?? (inferred ? 0.9 : 1),
        name: seed.name ?? null,
        ...seed,
    };
}

export function makeSnapshot(
    tables: TableSeed[],
    relationships: RelSeed[] = [],
    driver = 'sqlite',
): SchemaSnapshot {
    return {
        driver,
        database: 'test',
        schema: 'main',
        generated_at: '2026-10-15T00:00:00Z',
        hash: 'h',
        tables: tables.map(makeTable),
        relationships: relationships.map(makeRelationship),
        truncated: false,
        total_objects: tables.length,
    };
}
