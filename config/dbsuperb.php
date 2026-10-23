<?php

return [
    // Comma-separated directories that SQLite connection files must live in.
    'sqlite_paths' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('DBSUPERB_SQLITE_PATHS', '')),
    ))),

    // API requests per user per minute, at least 1 (the e2e server raises it: every spec signs in as the same user).
    'api_per_minute' => max(1, (int) env('DBSUPERB_API_PER_MINUTE') ?: 120),

    // Seconds to wait when opening a connection to a database server.
    'connect_timeout' => (int) env('DBSUPERB_CONNECT_TIMEOUT') ?: 5,

    // SQLite tables are counted exactly up to this many rows, then shown as "N+".
    'sqlite_count_cap' => 100000,

    // Schema snapshots retained per connection.
    'snapshot_keep' => 20,

    // Seconds any single schema-introspection statement may run.
    'introspection_timeout' => (int) env('DBSUPERB_INTROSPECTION_TIMEOUT') ?: 30,

    // Seconds any single data query (table samples, later the SQL editor) may run.
    'query_timeout' => (int) env('DBSUPERB_QUERY_TIMEOUT') ?: 15,

    // Seconds a background row count may take before the grid shows "N+ rows" instead of a total.
    'count_cap_seconds' => (int) env('DBSUPERB_COUNT_CAP_SECONDS') ?: 2,

    // Maximum tables + views kept in one snapshot; larger schemas are truncated alphabetically.
    'schema_max_objects' => (int) env('DBSUPERB_SCHEMA_MAX_OBJECTS') ?: 5000,

    // Query history entries kept per connection.
    'history_keep' => (int) env('DBSUPERB_HISTORY_KEEP') ?: 5000,
];
