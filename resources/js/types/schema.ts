export interface RowCountSchema {
    count: number | null;
    kind: 'exact' | 'estimate' | 'at_least' | 'unknown';
}

export interface ColumnSchema {
    name: string;
    type: string;
    type_name: string;
    nullable: boolean;
    default: string | null;
    auto_increment: boolean;
    comment: string | null;
}

export interface IndexSchema {
    name: string;
    columns: string[];
    unique: boolean;
    primary: boolean;
}

export interface TableSchema {
    name: string;
    kind: 'table' | 'view';
    row_count: RowCountSchema;
    size_bytes: number | null;
    primary_key: string[];
    columns: ColumnSchema[];
    indexes: IndexSchema[];
}

export interface RelationshipSchema {
    id: string;
    from_table: string;
    from_columns: string[];
    to_table: string;
    to_columns: string[];
    inferred: boolean;
    confidence: number;
    name: string | null;
}

export interface SchemaSnapshot {
    driver: string;
    database: string;
    schema: string | null;
    generated_at: string;
    hash: string;
    tables: TableSchema[];
    relationships: RelationshipSchema[];
}

export interface SchemaResponse {
    snapshot: SchemaSnapshot;
    snapshot_id: number;
    stored_at: string;
}

export interface DbErrorPayload {
    kind: string;
    message: string;
    sqlstate: string | null;
    reason: string | null;
}
