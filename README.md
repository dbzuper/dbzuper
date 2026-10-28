<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/dbzuper-logo-dark.svg">
  <img src="docs/images/dbzuper-logo.svg" alt="DBZuper" width="320">
</picture>

# DBZuper

**One Workspace. Every Database.** A self-hosted, visual database workspace for MySQL, MariaDB, PostgreSQL and SQLite.

![DBZuper: the Schema Universe, the SQL editor suggesting a foreign-key JOIN, and a filtered data table](docs/images/screenshot-hero.png)

- **Schema Universe**: your schema as a zoomable graph of tables, relationships (declared and inferred) and clusters, with path finding and JOIN generation.
- **SQL workspace**: Monaco editor with schema-aware autocompletion, tabs per connection, explain, confirm-before-write safety, read-only connections and query history.
- **Data explorer**: server-side filters, sorting and paging per table, plus a record explorer that follows a row through its relationships.
- **Dark by default**: ink and paper themes (dark, light or system), keyboard-first with a command palette, and an automated accessibility gate.
- **Self-hosted**: one Docker image, no external services at runtime, credentials encrypted at rest.

## Quick start (Docker)

    docker compose up -d --build --wait
    docker compose exec app php artisan dbzuper:install --name=Admin --email=admin@example.com --password='Str0ng-passphrase' --no-interaction

`--wait` returns once the container's healthcheck passes. Then open <http://localhost:8080> (or skip the second command and use the setup screen). HTTPS, SQLite files, backups, upgrades and the full environment reference are in [docs/self-hosting.md](docs/self-hosting.md).

## Local development

Requires PHP 8.4 (pdo_mysql, pdo_pgsql, pdo_sqlite), Composer 2 and Node 24.

    composer install && npm install
    cp .env.example .env && php artisan key:generate
    php artisan migrate
    php artisan dbzuper:install      # create the admin user
    composer run dev

## Try it with demo data

    php artisan dbzuper:demo-database          # add --force to re-create an existing demo database

Then add `storage/app/demo` (absolute path) to `DBZUPER_SQLITE_PATHS` in `.env` and create a SQLite connection to `storage/app/demo/commerce.sqlite`.

## The Schema Universe

Open a connection to see its schema as a graph: tables are nodes (sized by row count), relationships are edges
(lighter edges are inferred from `*_id` naming), and colours mark clusters of related tables.

- Scroll to zoom: far out shows cluster names, mid-range shows table names, close up shows column cards.
- Hover to highlight neighbours, click to open the inspector, double-click to focus on a neighbourhood.
- Drag a table to pin it; layouts are saved per connection.
- ⌘K / Ctrl+K searches tables, columns and actions. Esc clears the path, focus, then selection.
- "Find path to…" in the inspector shows the relationship chain between two tables and a ready-to-copy JOIN.
- Large schemas: `php artisan dbzuper:demo-database storage/app/demo/large.sqlite --tables=2000` builds a test schema.
  Snapshots keep at most `DBZUPER_SCHEMA_MAX_OBJECTS` (default 5000) tables and views.

## SQL workspace

Open the SQL editor with Ctrl/⌘+J or the rail. It autocompletes tables, columns and foreign-key joins from the schema, and keeps tabs per connection.

- Tab indents inside the editor. To move focus out of it with the keyboard, press Ctrl+M (⌃⇧M on a Mac) to make Tab move focus, and press it again to switch back; the toolbar shows the shortcut.
- Run the statement at the cursor (or the selection) with Ctrl/⌘+Enter; run every statement with Ctrl/⌘+Shift+Enter (one connection, so transactions work across the batch).
- Each run uses a fresh connection, so a transaction only spans a single run: run `BEGIN … COMMIT` together. A transaction still open when a run ends is rolled back, and the results panel says so.
- Explain shows the query plan. It refuses `EXPLAIN ANALYZE` of writes, which would execute them.
- Writes, DDL and session statements need a confirm click. Destructive ones (`UPDATE`/`DELETE` without `WHERE`, `DROP`, `TRUNCATE`) need the target table (or the keyword, when there is no target) typed back. A statement naming several objects (`DROP TABLE a, b`, `TRUNCATE a, b`) needs all of them typed back as listed, separated by a comma and a space (`a, b`).
- Read-only connections refuse everything except reads and transactions, and re-assert read-only before every statement.
- Limits: the row limit defaults to 1,000 and goes up to 10,000, cells are cut at 4,000 characters, a batch response is capped at 20 MB, and statements have a timeout (`DBZUPER_QUERY_TIMEOUT`, default 15 seconds). The timeout covers every statement on MariaDB (`max_statement_time`) and PostgreSQL (`statement_timeout`), only `SELECT` statements on MySQL (`max_execution_time`), and nothing on SQLite, which runs in-process.
- Cancel stops waiting for the response; the server may still finish the statement.
- The SQL editor also works when the schema could not be loaded; only autocompletion is off until the schema loads.
- The Data tab in the inspector adds server-side filters, sorting (click a column header) and paging; "Open in SQL" opens the equivalent query in the editor. `contains`, `starts with` and `ends with` ignore case on every engine: PostgreSQL uses `ILIKE`, while MySQL, MariaDB and SQLite use `LIKE`, which is case-insensitive for ASCII with their default collations (a column with a case-sensitive or binary collation stays case-sensitive). Comparison operators (`=`, `≠`, `<`, `≤`, `>`, `≥`) need a value.
- History is kept per connection (rail > History) and across connections on `/history`, trimmed to `DBZUPER_HISTORY_KEEP` entries per connection (default 5000). SQL is stored as typed, except that the literal after `PASSWORD`, `IDENTIFIED BY` and `IDENTIFIED WITH … BY` (also `ENCRYPTED PASSWORD`) is replaced by `'***'`; still avoid putting other secrets in SQL on connections with history enabled.

## Record explorer

Follow a single row through its relationships. The Records view (rail > Records) shows each record as a card with a title, a few fields and one port per relationship; clicking a port adds the related records next to it.

- Open a record from the command palette (Ctrl/⌘+K, then `users 42`, or `product_tags 1, rgb` for a composite key), from a foreign-key cell, from the Data tab or a result row ("Open record").
- Ports: "Belongs to" ports open the parent record (disabled when the key is NULL); "Has many" ports show a record count, which stops at 10,000+. Inferred relationships are dashed and need "Show inferred" on.
- A has-many port adds the first 25 records and a "+N more" node, which offers "Add next 25" and "Open in Data tab".
- The trail is kept in the URL (`?r=…`), so it is shareable and works with the browser's Back and Forward. It holds at most 100 records.
- "Copy path as SQL" turns the path from the first record to the selected one into a `SELECT … JOIN … WHERE` query and opens it in a new "Record path" tab in the SQL dock. It does not run it; press Ctrl/⌘+Enter when you want the results.
- Tables without a primary key, views, and tables whose primary key is binary cannot be opened here; the explorer points you to the Data tab instead.
- The explorer is read-only. Its reads are generated by the app and are not stored in history.

## Security notes

- The setup screen is public until the first administrator exists. Run `php artisan dbzuper:install` before exposing the app to a network.
- Behind a reverse proxy, set `TRUSTED_PROXIES` (comma-separated IPs/CIDRs, or `*`) so client IPs and HTTPS are detected. Leave it unset when the app is reached directly: then no `X-Forwarded-*` header is trusted.
- Saved credentials are encrypted with `APP_KEY`. Back it up: losing it makes saved passwords unrecoverable.
- DBZuper connects to any host reachable from the server. Only the administrator can create connections.
- Changing anything that reaches the connection string (driver, host, port, username, database, SSL options or PostgreSQL schema) requires re-entering the stored password. PostgreSQL host, database, username and CA path may not contain spaces, quotes or backslashes.
- Accounts cannot be deleted from the UI: DBZuper has a single administrator.
- SQLite files are only opened inside directories listed in `DBZUPER_SQLITE_PATHS`. The SQL editor therefore refuses `ATTACH`, `DETACH`, `VACUUM INTO` and the `temp_store_directory`/`data_store_directory` pragmas on SQLite connections, which would reach other files.
- Connections marked read-only are enforced by the database session (MySQL/MariaDB `READ ONLY` transactions, PostgreSQL read-only session, SQLite read-only open mode).

## Performance

- **Chunks.** Sigma, graphology, Monaco, react-data-grid and React Flow are loaded on demand: the app entry and every page chunk stay free of them. `npm run build` ends with `scripts/check-chunks.mjs`, which reads `public/build/manifest.json` and `storage/build/chunk-modules.json` (written by a small plugin in `vite.config.ts`, outside `public/` so it is not served), follows only static imports from the app entry and each page, and fails the build if a banned package shows up.
- **Prefetch.** Hovering or focusing a connection link in the connections list prefetches the workspace page, the universe model kit and (when WebGL2 is available) the universe canvas.
- **Monaco** loads only when the SQL dock opens, and only registers the editor features and the SQL, MySQL and PostgreSQL languages the app uses.
- **Budgets** (e2e, never loosened): universe ready < 2000 ms, record expansion < 300 ms, `/connections` first contentful paint < 1000 ms.
- **Compression and caching.** Serve `/build/*` compressed (`encode zstd br gzip` in the Caddyfile that ships with the Docker image) and with `Cache-Control: public, max-age=31536000, immutable`: build filenames are content-hashed, so they never change. Do not long-cache HTML or `/build/manifest.json`.

## Upgrading

- **Dark by default.** New visitors now get the dark theme. If you had already chosen an appearance (including "system"), it is stored in your browser and kept. Switch any time with the theme button in the header or sidebar, "Toggle theme" in the command palette (Ctrl/⌘+K), or Settings > Appearance.
- Docker installs: see [Upgrades](docs/self-hosting.md#upgrades) in the self-hosting guide.

## Testing

    php artisan test     # Pest: unit, feature and engine integration tests
    npm run test         # Vitest
    npm run e2e          # Playwright (run `npm run build` first)

Engine integration tests use real servers and skip any that are unreachable (set `DBZUPER_REQUIRE_ENGINES=1`, as CI does, to fail instead):

- MySQL 8.4 (port 3307) and MariaDB 11.4 (port 3308): `docker compose -f docker-compose.test.yml up -d`
  (on Windows: `wsl -d Ubuntu -- docker compose -f /mnt/c/<path>/docker-compose.test.yml up -d`).
- PostgreSQL 18 on port 5432: the tests create and use only the `dbzuper_test` database.

Credentials come from the `TEST_*` variables in `.env`.

## License

DBZuper is open source under the [MIT license](LICENSE). The DBZuper name and logo are not covered by it: see
[TRADEMARKS.md](TRADEMARKS.md) before publishing a fork.
