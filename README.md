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

## Tests
See "Testing" below (filled in during M0 Task 3).
