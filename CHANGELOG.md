# Changelog

## 0.2.0 (2026-10-30)

- **Password policy setting**: `DBZUPER_PASSWORD_POLICY=basic` relaxes account passwords to 8 characters with no
  breach check, for private local installs. The default stays `strong`.
- **Password reset without email**: `php artisan dbzuper:reset-password` sets a new password from the server, with
  `--reset-2fa` for lost two-factor codes. The login page's reset link now appears only when `MAIL_MAILER` is set
  up (it is `log` by default, which sends nothing); otherwise it asks you to contact the server admin.
- **Readable dropdowns in dark mode**: native select lists no longer show light text on a white list.
- **Self-hosting guide**: a step-by-step Docker Compose setup with `.env.docker`, where the volumes live and how to use
  a normal folder instead, and reaching databases on the same computer (host-bound users, firewalls, Docker inside
  WSL).

## 0.1.0 (2026-10-29): first public release

DBZuper is a self-hosted, visual database workspace for MySQL, MariaDB, PostgreSQL and SQLite: a Schema Universe
graph of every table and relationship, a SQL workspace with schema-aware autocompletion and confirm-before-write
safety, a data and record explorer, server-level connections, and one Docker image.

Highlights of the setup:

- **Published image** `ghcr.io/dbzuper/dbzuper` for linux/amd64 and linux/arm64: one `docker run`, no clone or build.
- **Setup code**: until the administrator exists, the setup screen asks for a one-time code printed in the server
  log, so a fresh install reachable on a network can't be claimed by someone else.
- **Try it with demo data**: one click on an empty install builds a sample SQLite database and opens it.
- **Databases on the Docker host**: the connection form explains `host.docker.internal` when you type `localhost`
  inside Docker, and the Compose file maps that name on Linux.
- **Dark by default**: new visitors get the dark theme; an appearance already chosen in the browser is kept.

### Not yet included

- **Import and export** of table data and query results.
- **Server-side query cancellation**: cancelling stops waiting for a query, but the database keeps running it until
  it finishes or reaches its time limit.
- **SSH tunnels**: connect to databases the DBZuper server can reach directly.

### Upgrading from a pre-release build

Builds from before the public release used the working name DBSuperb in their internal identifiers. Those are now
`dbzuper`, with no fallback to the old names:

- **Environment variables**: rename every `DBSUPERB_*` variable to `DBZUPER_*` (for example `DBSUPERB_SQLITE_PATHS`
  becomes `DBZUPER_SQLITE_PATHS`), in `.env` or `.env.docker`. Old names are ignored.
- **Artisan commands**: `dbsuperb:install` and `dbsuperb:demo-database` are now `dbzuper:install` and
  `dbzuper:demo-database`.
- **Docker volumes**: the Compose file now uses `dbzuper-storage` and `dbzuper-sqlite`. Your data is still in the old
  volumes; copy it across before starting the new version (Compose prefixes volume names with the project, often the
  directory name: check with `docker volume ls`):

      docker compose down
      docker run --rm -v <project>_dbsuperb-storage:/from -v <project>_dbzuper-storage:/to alpine cp -a /from/. /to/
      docker run --rm -v <project>_dbsuperb-sqlite:/from -v <project>_dbzuper-sqlite:/to alpine cp -a /from/. /to/
      docker compose up -d

    The `APP_KEY` lives in the storage volume, so saved connection passwords keep working once it is copied.

- **Browser preferences**: saved SQL tabs, layouts and grid settings start fresh (their storage keys were renamed).
