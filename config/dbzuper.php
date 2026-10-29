<?php

return [
    // Comma-separated directories that SQLite connection files must live in. Relative ones are relative to the
    // app directory (not the working directory, which differs between `artisan serve`, a web server and the CLI).
    'sqlite_paths' => array_values(array_map(
        fn (string $dir) => preg_match('~^([/\\\\]|[A-Za-z]:[/\\\\])~', $dir) === 1 ? $dir : base_path($dir),
        array_filter(array_map('trim', explode(',', (string) env('DBZUPER_SQLITE_PATHS', '')))),
    )),

    // Where the one-time setup code is kept until the first administrator exists.
    'setup_code_path' => env('DBZUPER_SETUP_CODE_PATH') ?: storage_path('app/private/setup-code'),

    // Set by the Docker image: there `localhost` is the container itself, so the connection form points
    // people at host.docker.internal instead.
    'in_container' => (bool) env('DBZUPER_IN_CONTAINER', false),

    // Account passwords in production: `strong` (the default: 12+ characters, mixed case, number, symbol, not in a
    // known breach) or `basic` (8+ characters, for a private local install).
    'password_policy' => env('DBZUPER_PASSWORD_POLICY', 'strong'),

    // API requests per user per minute, at least 1 (the e2e server raises it: every spec signs in as the same user).
    'api_per_minute' => max(1, (int) env('DBZUPER_API_PER_MINUTE') ?: 120),

    // Seconds to wait when opening a connection to a database server.
    'connect_timeout' => (int) env('DBZUPER_CONNECT_TIMEOUT') ?: 5,

    // SQLite tables are counted exactly up to this many rows, then shown as "N+".
    'sqlite_count_cap' => 100000,

    // Schema snapshots retained per connection.
    'snapshot_keep' => 20,

    // Seconds any single schema-introspection statement may run.
    'introspection_timeout' => (int) env('DBZUPER_INTROSPECTION_TIMEOUT') ?: 30,

    // Seconds any single data query (table samples, later the SQL editor) may run.
    'query_timeout' => (int) env('DBZUPER_QUERY_TIMEOUT') ?: 15,

    // Seconds a background row count may take before the grid shows "N+ rows" instead of a total.
    'count_cap_seconds' => (int) env('DBZUPER_COUNT_CAP_SECONDS') ?: 2,

    // Maximum tables + views kept in one snapshot; larger schemas are truncated alphabetically.
    'schema_max_objects' => (int) env('DBZUPER_SCHEMA_MAX_OBJECTS') ?: 5000,

    // Query history entries kept per connection.
    'history_keep' => (int) env('DBZUPER_HISTORY_KEEP') ?: 5000,
];
