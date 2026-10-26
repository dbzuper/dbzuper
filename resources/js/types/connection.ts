export type DriverValue = 'mysql' | 'mariadb' | 'pgsql' | 'sqlite';

/** TLS for MySQL and MariaDB (PostgreSQL uses sslmode). */
export type MySqlSslMode = 'disabled' | 'required' | 'verify_identity';

export interface ConnectionOptions {
    sslmode?:
        | 'disable'
        | 'allow'
        | 'prefer'
        | 'require'
        | 'verify-ca'
        | 'verify-full';
    mysql_ssl?: MySqlSslMode;
    ssl_ca?: string;
    /** Only on MySQL connections saved before mysql_ssl existed; see mysqlSslMode(). */
    ssl_verify?: boolean;
    schema?: string;
}

/**
 * What a workspace talks to: "5" for a connection with a fixed database, "5:shop" for one database of a
 * server-level connection. API URLs, stores and per-workspace browser storage are keyed on it.
 */
export type WorkspaceRef = string;

/** Whether a stored key is a workspace ref (e.g. read back from browser storage). */
export function isWorkspaceRef(value: string): value is WorkspaceRef {
    return /^\d+(:.+)?$/s.test(value);
}

export interface ConnectionSummary {
    id: number;
    /** The workspace this connection object addresses: see WorkspaceRef. */
    ref: WorkspaceRef;
    name: string;
    driver: DriverValue;
    driver_label: string;
    host: string | null;
    port: number | null;
    /** Null for a server-level connection, which can open any database on the server. */
    database: string | null;
    username: string | null;
    has_password: boolean;
    options: ConnectionOptions;
    read_only: boolean;
    color: string | null;
    store_history: boolean;
    /** ISO time of the last workspace visit, or null if never opened. */
    last_opened_at: string | null;
    /** Saved without a database: opens on the database list. */
    server_level: boolean;
    /** The database last opened through a server-level connection. */
    last_database: string | null;
}

/** A connection on the connections page, with its latest snapshot summary. */
export interface ConnectionCard extends ConnectionSummary {
    tables: number | null;
    views: number | null;
    /** ISO time of the latest snapshot, or null if there is none. */
    snapshot_at: string | null;
    /** The database name, or "All databases" for a server-level connection. */
    database_label: string;
    /** The first five pinned table names, in pin order. */
    pins: string[];
    /** Preview nodes in the unit square; `points` is null without a saved layout, and a null point is seeded on the client. */
    star: {
        points: ([number, number] | null)[] | null;
        edges: [number, number][];
        count: number;
    } | null;
}

export interface ConnectionFormData {
    connection_id: number | null;
    name: string;
    driver: DriverValue;
    host: string;
    port: number | null;
    database: string;
    username: string;
    password: string;
    clear_password: boolean;
    options: ConnectionOptions;
    read_only: boolean;
    color: string;
    store_history: boolean;
}

export interface DriverChoice {
    value: DriverValue;
    label: string;
    default_port: number | null;
}

export interface ConnectionTestResult {
    ok: boolean;
    version: string | null;
    latency_ms: number;
    error: {
        kind: string;
        message: string;
        sqlstate: string | null;
        reason: string | null;
    } | null;
}
