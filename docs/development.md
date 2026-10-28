# Developing DBZuper

## Local development

Requires PHP 8.4 (pdo_mysql, pdo_pgsql, pdo_sqlite), Composer 2 and Node 24.

    composer setup       # install dependencies, create .env and the app key, migrate, build, print the setup code
    composer run dev     # app, queue and Vite with hot reload, for working on DBZuper

`composer start` (`php artisan serve`) is enough to just run it. Create the administrator with the setup code, or run
`php artisan dbzuper:install`.

SQLite connections may open files in `storage/app/sqlite` (the `DBZUPER_SQLITE_PATHS` default in `.env.example`), and
the empty connections page offers **Try it with demo data**. `php artisan dbzuper:demo-database` writes the demo to
`storage/app/demo/commerce.sqlite` instead; add `storage/app/demo` to `DBZUPER_SQLITE_PATHS` to open it.

## Checks

    php artisan test       # Pest: unit, feature and engine integration tests
    npm run test           # Vitest
    npm run e2e            # Playwright (run `npm run build` first)
    composer types:check   # PHPStan (Larastan, level 7)
    npm run types:check    # TypeScript
    npm run check          # formatting and lint

CI runs all of them; PHPStan and TypeScript are expected to stay at zero errors.

Engine integration tests use real servers and skip any that are unreachable (set `DBZUPER_REQUIRE_ENGINES=1`, as CI does, to fail instead):

- MySQL 8.4 (port 3307) and MariaDB 11.4 (port 3308): `docker compose -f docker-compose.test.yml up -d`
  (on Windows: `wsl -d Ubuntu -- docker compose -f /mnt/c/<path>/docker-compose.test.yml up -d`).
- PostgreSQL 18 on port 5432: the tests create and use only the `dbzuper_test` database.

Credentials come from the `TEST_*` variables in `.env`. The engine tests share the test database, so run them in one
process (`php artisan test tests/Feature/Engines`) rather than with `--parallel`.

## Releases

Pushing a version tag (`git tag v1.2.0 && git push origin v1.2.0`) runs `.github/workflows/release.yml`, which builds the
Docker image for linux/amd64 and linux/arm64 and publishes it as `ghcr.io/dbzuper/dbzuper` with the tags `1.2.0`, `1.2`
and `latest` (a pre-release such as `v1.3.0-rc1` gets only its own tag). Make the package public in the repository's
package settings once, so people can pull it without signing in.

## Performance

- **Chunks.** Sigma, graphology, Monaco, react-data-grid and React Flow are loaded on demand: the app entry and every page chunk stay free of them. `npm run build` ends with `scripts/check-chunks.mjs`, which reads `public/build/manifest.json` and `storage/build/chunk-modules.json` (written by a small plugin in `vite.config.ts`, outside `public/` so it is not served), follows only static imports from the app entry and each page, and fails the build if a banned package shows up.
- **Prefetch.** Hovering or focusing a connection link in the connections list prefetches the workspace page, the universe model kit and (when WebGL2 is available) the universe canvas.
- **Monaco** loads only when the SQL dock opens, and only registers the editor features and the SQL, MySQL and PostgreSQL languages the app uses.
- **Budgets** (e2e, never loosened): universe ready < 2000 ms, record expansion < 300 ms, `/connections` first contentful paint < 1000 ms.
- **Compression and caching.** Serve `/build/*` compressed (`encode zstd br gzip` in the Caddyfile that ships with the Docker image) and with `Cache-Control: public, max-age=31536000, immutable`: build filenames are content-hashed, so they never change. Do not long-cache HTML or `/build/manifest.json`.
