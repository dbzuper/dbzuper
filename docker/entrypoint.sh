#!/bin/sh
# DBZuper container entrypoint: prepare storage, persist APP_KEY, then either run the given command
# (one-off artisan use: `docker compose run --rm app php artisan ...`) or migrate, cache and serve.
set -eu

cd /app

# DBZUPER_SQLITE_PATHS is comma-separated: create each directory.
sqlite_paths="${DBZUPER_SQLITE_PATHS:-/data/sqlite}"
old_ifs="$IFS"; IFS=','
for dir in $sqlite_paths; do
    dir="$(printf '%s' "$dir" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -n "$dir" ] && mkdir -p "$dir"
done
IFS="$old_ifs"

mkdir -p storage/app/public storage/database storage/logs \
    storage/framework/cache/data storage/framework/sessions storage/framework/views \
    bootstrap/cache

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
        (
            umask 077
            php artisan key:generate --show --no-ansi > "$keyfile.tmp"
        )
        mv "$keyfile.tmp" "$keyfile"
        echo "entrypoint: generated a new APP_KEY in /app/storage/app.key" >&2
    fi
    APP_KEY="$(cat "$keyfile")"
    export APP_KEY
fi

# One-off command: run it with the prepared environment instead of starting the server.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# Never reuse a config cache from a previous start: rebuild it from this start's environment.
php artisan config:clear
php artisan migrate --force --no-interaction

php artisan config:cache
php artisan route:cache
php artisan view:cache

exec frankenphp run --config /etc/caddy/Caddyfile
