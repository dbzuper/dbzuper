#!/bin/sh
# DBSuperb container entrypoint: prepare storage, persist APP_KEY, migrate, cache, then serve.
set -eu

cd /app

mkdir -p storage/app/public storage/database storage/logs \
    storage/framework/cache/data storage/framework/sessions storage/framework/views \
    bootstrap/cache "${DBSUPERB_SQLITE_PATHS:-/data/sqlite}"

# The application database (users, connections, history, sessions) is a SQLite file in the storage volume.
if [ "${DB_CONNECTION:-sqlite}" = "sqlite" ]; then
    db="${DB_DATABASE:-/app/storage/database/database.sqlite}"
    mkdir -p "$(dirname "$db")"
    [ -e "$db" ] || touch "$db"
fi

# APP_KEY encrypts saved connection passwords. Use the supplied key; otherwise generate one once and
# keep it in the storage volume so it survives restarts and image upgrades.
if [ -z "${APP_KEY:-}" ]; then
    keyfile=storage/app.key
    if [ ! -s "$keyfile" ]; then
        php artisan key:generate --show --no-ansi > "$keyfile.tmp"
        chmod 600 "$keyfile.tmp"
        mv "$keyfile.tmp" "$keyfile"
        echo "entrypoint: generated a new APP_KEY in /app/storage/app.key" >&2
    fi
    APP_KEY="$(cat "$keyfile")"
    export APP_KEY
fi

php artisan migrate --force --no-interaction

# Config is cached from the environment of this start, so changing env and restarting takes effect.
php artisan config:cache
php artisan route:cache
php artisan view:cache

exec frankenphp run --config /etc/caddy/Caddyfile
