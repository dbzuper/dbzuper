# Changelog

## Unreleased: first public release

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
