# DBZuper user guide

How the workspace behaves, screen by screen. For installing and running DBZuper see [self-hosting.md](self-hosting.md).

## Try it with demo data

On a fresh install with no connections, **Try it with demo data** builds a small commerce database in SQLite (users,
products, orders and their relationships) and opens it. It is an ordinary connection you can delete. The button needs an
allowed SQLite directory (`DBZUPER_SQLITE_PATHS`, `/data/sqlite` in the Docker image): the demo file is written there.

From the command line, `php artisan dbzuper:demo-database` writes the same database to `storage/app/demo/commerce.sqlite`
(add `--force` to re-create it).

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

## Themes

Dark is the default for new visitors; an appearance already chosen in the browser (including "system") is kept. Switch
any time with the theme button in the header or sidebar, "Toggle theme" in the command palette (Ctrl/⌘+K), or
Settings > Appearance.
