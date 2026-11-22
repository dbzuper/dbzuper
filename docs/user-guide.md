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

## Backup & restore

Back up the open database to a `.sql` or `.sql.gz` file on your computer, or restore one into it: **Backup & restore**
in the workspace header, or "Back up database…" / "Restore from file…" in the command palette (Ctrl/⌘+K). On a server
connection it works on the selected database. Both run in the background, so a multi-GB database works too; the
dialog shows progress and can cancel. For setting up the background workers and native tools, see
[self-hosting.md](self-hosting.md#backup-and-restore).

### Backing up

- **Tables:** All, or Choose… to pick tables and views from a searchable list (grouped by schema on PostgreSQL). Triggers
  follow their table. Routines and events (MySQL/MariaDB) are only included with All.
- **Include:** Structure, Data, or both. **Add DROP … IF EXISTS before each CREATE** is on by default, so the file
  restores over an existing copy.
- **Compress (.sql.gz)** gzips the file. The download is named `{database}-{YYYYMMDD-HHmmss}.sql[.gz]`.
- The file is kept for 24 hours (`DBZUPER_TRANSFER_TTL`), so a failed download can be retried. Recent backups are
  listed in the dialog until then.
- A backup reads one consistent snapshot, except MyISAM and Aria tables on MySQL/MariaDB, which are not transactional:
  they can change while the backup runs.
- PostgreSQL backups cover every non-system schema (not just the connection's schema), and leave out owners and
  privileges (`--no-owner --no-privileges`), so they restore under another login.
- Row-level security: a table with RLS policies can only be backed up by its owner or a role with `BYPASSRLS`; otherwise
  the backup fails instead of silently leaving rows out.
- A finished backup adds one entry to the connection's history ("Backup: …"), when history is on.

### Native or built-in

Each backup and restore uses one of two methods, shown under **Method**:

- **Native** runs the engine's own tools: `mysqldump`/`mysql` for MySQL, `mariadb-dump`/`mariadb` for MariaDB,
  `pg_dump`/`psql` for PostgreSQL. It is the default whenever a compatible tool is found, because it is faster and
  covers everything.
- **Built-in** is DBZuper's own exporter and importer, written in PHP. It always works and needs no tools.
- A tool is compatible when its version is at least the server's (PostgreSQL: `pg_dump` 18 dumps any server up to
  18; MySQL: `mysqldump` 8.4 dumps MySQL 5.7 to 8.4) and it comes from the same engine: MySQL's tools don't count for
  MariaDB, nor MariaDB's for MySQL 8+. Otherwise the dialog says why ("pg_dump 16 found, server is 18 — using
  built-in") and uses built-in. You can always switch to built-in; native can't be forced.
- SQLite always uses built-in, in both directions (it runs in-process, so a tool gains nothing).
- Native MySQL/MariaDB backups round `FLOAT` (single-precision) columns to 6 significant digits, a `mysqldump` limit.
  When the chosen tables have `FLOAT` columns the dialog warns; use built-in for exact values.
- Native MySQL/MariaDB backups with All leave out routines or events the login has no permission to read, and say so
  before you start.

What built-in leaves out (the dialog lists it before you start, and the file header repeats it):

- **MySQL/MariaDB:** stored procedures and functions, events, sequences (MariaDB), system-versioned history (MariaDB;
  only the current rows are kept).
- **PostgreSQL:** functions and procedures, triggers (they need their function), extensions, domains and composite
  types, materialized views, row-level security policies, rules, extended statistics, foreign tables, ownership and
  privileges, other table settings (replica identity, `CLUSTER ON`, column storage and statistics targets), and typed
  tables (restored as plain tables). Partitioned tables are included with their partitions.
- **SQLite:** nothing.

### Restoring

- Choose a `.sql` or `.sql.gz` file: a DBZuper backup, a `mysqldump`/`mariadb-dump` file, a plain-format `pg_dump`
  file or a `sqlite3 .dump`. Compression is detected from the file's content, not its name. A file that looks like it
  came from another engine gets a warning (not a block).
- Type the database name to confirm: the restore runs every statement in the file against it, and existing tables
  may be dropped or overwritten.
- Read-only connections can't restore; the menu item says why.
- **Always into the open database:** `USE`, `CREATE DATABASE`, `DROP DATABASE`, `ALTER DATABASE <name>` (and their
  `SCHEMA` synonyms on MySQL/MariaDB), PostgreSQL `COMMENT ON DATABASE` and psql `\connect` are removed from the file.
  This is what lets a production dump restore into a local copy under another name. A file that switches between two or more
  databases (`--databases a b`, `--all-databases`) is refused when the second one appears.
- Client commands are refused, for security: psql meta-commands other than `\restrict`/`\unrestrict` (`\!`, `\copy`,
  `\i`, …) and mysql client commands (`system`, `source`, …). A dump file is untrusted input, and these could run
  programs or read files on the DBZuper server.
- Built-in can't run `COPY … FROM stdin` (the `pg_dump` default for data): such files need the native method, which
  needs `psql`.
- **Stops at the first failing statement**, and shows its number, the start of the statement and the database's error.
  - PostgreSQL and SQLite: all or nothing. The restore runs in one transaction, so a failure changes nothing; the
    database stays locked until the restore finishes.
  - MySQL/MariaDB: DDL commits on its own, so the statements before the failing one stay applied.
- **Upload:** the file is sent in pieces, and a dropped connection picks up where the server left off. Keep the dialog
  open until the upload finishes: closing it stops the upload. An upload with no progress for 10 minutes
  (`DBZUPER_TRANSFER_UPLOAD_IDLE_MINUTES`) is abandoned. The largest file accepted is 20 GB by default
  (`DBZUPER_TRANSFER_MAX_BYTES`).
- After a restore the schema is reloaded, and one history entry ("Restore: …") is added when history is on.

### Limits

- One backup or restore per database at a time; a second one is refused ("A backup of this database is already
  running"). Other databases and users run side by side, up to the number of workers.
- "Waiting for a free worker…" means every worker is busy. "No background worker is running" means none is started;
  see [self-hosting.md](self-hosting.md#backup-and-restore).
- Only the person who started a backup or restore can see, download or cancel it.

## Themes

Dark is the default for new visitors; an appearance already chosen in the browser (including "system") is kept. Switch
any time with the theme button in the header or sidebar, "Toggle theme" in the command palette (Ctrl/⌘+K), or
Settings > Appearance.
