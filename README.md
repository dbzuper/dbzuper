# DBSuperb

**One Workspace. Every Database.** A self-hosted, visual database workspace for MySQL, MariaDB, PostgreSQL and SQLite.

## Requirements

PHP 8.4 (pdo_mysql, pdo_pgsql, pdo_sqlite), Composer 2, Node 24.

## Local setup

    composer install && npm install
    cp .env.example .env && php artisan key:generate
    php artisan migrate
    php artisan dbsuperb:install      # create the admin user
    composer run dev

## Try it with demo data

    php artisan dbsuperb:demo-database          # add --force to re-create an existing demo database

Then add `storage/app/demo` (absolute path) to `DBSUPERB_SQLITE_PATHS` in `.env` and create a SQLite connection to `storage/app/demo/commerce.sqlite`.

## The Schema Universe

Open a connection to see its schema as a graph: tables are nodes (sized by row count), relationships are edges
(lighter edges are inferred from `*_id` naming), and colours mark clusters of related tables.

- Scroll to zoom: far out shows cluster names, mid-range shows table names, close up shows column cards.
- Hover to highlight neighbours, click to open the inspector, double-click to focus on a neighbourhood.
- Drag a table to pin it; layouts are saved per connection.
- ⌘K / Ctrl+K searches tables, columns and actions. Esc clears the path, focus, then selection.
- "Find path to…" in the inspector shows the relationship chain between two tables and a ready-to-copy JOIN.
- Large schemas: `php artisan dbsuperb:demo-database storage/app/demo/large.sqlite --tables=2000` builds a test schema.
  Snapshots keep at most `DBSUPERB_SCHEMA_MAX_OBJECTS` (default 5000) tables and views.

## Security notes

- The setup screen is public until the first administrator exists. Run `php artisan dbsuperb:install` before exposing the app to a network.
- Behind a reverse proxy, set `TRUSTED_PROXIES` (comma-separated IPs/CIDRs, or `*`) so client IPs and HTTPS are detected. Leave it unset when the app is reached directly: then no `X-Forwarded-*` header is trusted.
- Saved credentials are encrypted with `APP_KEY`. Back it up: losing it makes saved passwords unrecoverable.
- DBSuperb connects to any host reachable from the server. Only the administrator can create connections.
- Changing anything that reaches the connection string (driver, host, port, username, database, SSL options or PostgreSQL schema) requires re-entering the stored password. PostgreSQL host, database, username and CA path may not contain spaces, quotes or backslashes.
- Accounts cannot be deleted from the UI: DBSuperb has a single administrator.
- SQLite files are only opened inside directories listed in `DBSUPERB_SQLITE_PATHS`.
- Connections marked read-only are enforced by the database session (MySQL/MariaDB `READ ONLY` transactions, PostgreSQL read-only session, SQLite read-only open mode).

## Testing

    php artisan test     # Pest: unit, feature and engine integration tests
    npm run test         # Vitest
    npm run e2e          # Playwright (run `npm run build` first)

Engine integration tests use real servers and skip any that are unreachable (set `DBSUPERB_REQUIRE_ENGINES=1`, as CI does, to fail instead):

- MySQL 8.4 (port 3307) and MariaDB 11.4 (port 3308): `docker compose -f docker-compose.test.yml up -d`
  (on Windows: `wsl -d Ubuntu -- docker compose -f /mnt/c/<path>/docker-compose.test.yml up -d`).
- PostgreSQL 18 on port 5432: the tests create and use only the `dbsuperb_test` database.

Credentials come from the `TEST_*` variables in `.env`.
