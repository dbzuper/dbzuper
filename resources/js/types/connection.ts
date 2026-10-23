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

export interface ConnectionSummary {
    id: number;
    name: string;
    driver: DriverValue;
    driver_label: string;
    host: string | null;
    port: number | null;
    database: string;
    username: string | null;
    has_password: boolean;
    options: ConnectionOptions;
    read_only: boolean;
    color: string | null;
    store_history: boolean;
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
