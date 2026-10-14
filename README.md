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

## Testing

    php artisan test     # Pest: unit, feature and engine integration tests
    npm run test         # Vitest
    npm run e2e          # Playwright (run `npm run build` first)

Engine integration tests use real servers and skip any that are unreachable:

- MySQL 8.4 (port 3307) and MariaDB 11.4 (port 3308): `docker compose -f docker-compose.test.yml up -d`
  (on Windows: `wsl -d Ubuntu -- docker compose -f /mnt/c/<path>/docker-compose.test.yml up -d`).
- PostgreSQL 18 on port 5432: the tests create and use only the `dbsuperb_test` database.

Credentials come from the `TEST_*` variables in `.env`.
