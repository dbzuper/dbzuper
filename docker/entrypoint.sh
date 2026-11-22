#!/bin/sh
# DBZuper container entrypoint: prepare storage, persist APP_KEY, then either run the given command
# (one-off artisan use: `docker compose run --rm app php artisan ...`, no workers) or migrate, cache, start the queue
# workers and serve.
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

# The address people open: the host port Compose publishes (DBZUPER_PORT), else the one the server listens on.
# An APP_URL set explicitly (a domain behind a proxy) wins.
export APP_URL="${APP_URL:-http://localhost:${DBZUPER_PORT:-${PORT:-8080}}}"

# One-off command: run it with the prepared environment instead of starting the server.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# Never reuse a config cache from a previous start: rebuild it from this start's environment.
php artisan config:clear
php artisan migrate --force --no-interaction
# No worker has started yet, so a backup or restore still marked running on this host was cut off by the restart:
# fail it now (and remove its partial file) instead of letting it hold its database.
php artisan dbzuper:transfers:recover

php artisan config:cache
php artisan route:cache
php artisan view:cache

# Until the first administrator exists, the setup screen asks for a one-time code: show it in the log.
php artisan dbzuper:setup-code

# Background workers next to the server: DBZUPER_TRANSFER_WORKERS (default 2) for backups and restores, and one for
# the default queue, each restarted when it exits (see start_worker). This shell stays as PID 1 (the server runs in
# the background instead of being exec'd) so that a stop signal reaches the workers too: it stops them and the server,
# and waits for them.
transfer_workers="${DBZUPER_TRANSFER_WORKERS:-2}"
case "$transfer_workers" in
    '' | *[!0-9]*)
        echo "entrypoint: DBZUPER_TRANSFER_WORKERS must be a whole number, got '$transfer_workers'" >&2
        exit 1
        ;;
esac

children=""
server_pid=""

# Stop the workers and the server, wait for all of them, then exit with the given status.
shutdown() {
    trap - TERM INT
    # shellcheck disable=SC2086 # the pid lists are meant to split
    kill -TERM $children $server_pid 2>/dev/null || true
    wait
    exit "$1"
}
trap 'shutdown 0' TERM INT

# start_worker NAME ARGS...: keep `php artisan ARGS` running until this subshell gets SIGTERM. A worker that exits is
# restarted after 1 s, doubling up to 30 s while it keeps failing; the delay resets once a run lasted over a minute.
# The delay runs as a waited-on child, so a stop signal ends it at once.
start_worker() {
    name="$1"
    shift
    (
        child=""
        trap 'if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" || true; fi; exit 0' TERM
        delay=1
        while :; do
            started=$(date +%s)
            php artisan "$@" &
            child=$!
            status=0
            wait "$child" || status=$?
            if [ $(($(date +%s) - started)) -gt 60 ]; then
                delay=1
            fi
            echo "entrypoint: $name worker exited with status $status; restarting it in ${delay}s" >&2
            sleep "$delay" &
            child=$!
            wait "$child" || true
            delay=$((delay * 2))
            if [ "$delay" -gt 30 ]; then
                delay=30
            fi
        done
    ) &
    children="$children $!"
}

i=0
while [ "$i" -lt "$transfer_workers" ]; do
    start_worker transfers queue:work transfers --queue=transfers --sleep=1 --tries=1 --timeout=0
    i=$((i + 1))
done
start_worker default queue:work database --queue=default --sleep=3 --tries=3

frankenphp run --config /etc/caddy/Caddyfile &
server_pid=$!

# A stop signal interrupts this wait and runs shutdown. Otherwise the server stopped on its own: give the workers 30 s
# to stop (a busy one finishes or is cut off), then exit non-zero; leaving PID 1 kills whatever is left, and the
# restart policy takes over. Waiting for a multi-hour job here would keep a container without a web server alive.
status=0
wait "$server_pid" || status=$?
server_pid=""
if [ "$status" -eq 0 ]; then
    status=1
fi
echo "entrypoint: the web server exited; stopping the workers" >&2
# shellcheck disable=SC2086 # the pid list is meant to split
kill -TERM $children 2>/dev/null || true
waited=0
while [ "$waited" -lt 30 ]; do
    alive=""
    for pid in $children; do
        if kill -0 "$pid" 2>/dev/null; then
            alive=1
        fi
    done
    [ -n "$alive" ] || break
    sleep 1
    waited=$((waited + 1))
done
exit "$status"
