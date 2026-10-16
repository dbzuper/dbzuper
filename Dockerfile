# syntax=docker/dockerfile:1

# DBSuperb production image: FrankenPHP 1.13 on PHP 8.4, non-root, port 8080.
#
# Build-stage choice: the Vite build runs the Wayfinder plugin, which shells out to
# `php artisan wayfinder:generate`, so the asset stage needs PHP *and* Node plus an installed vendor/.
# Rather than juggling separate composer and node images, the asset stage is based on the same
# PHP image as the runtime (extensions already installed, so layers are shared) with the Node 24
# binaries copied in from the official node image. Stages:
#   php-base -> vendor (composer --no-dev) -> assets (node + wayfinder + vite) -> runtime
#
# Pinned images (checked 2026-10-16): dunglas/frankenphp:1.13-php8.4, composer:2, node:24-bookworm-slim.

ARG FRANKENPHP_TAG=1.13-php8.4

# ---------------------------------------------------------------- php-base
FROM dunglas/frankenphp:${FRANKENPHP_TAG} AS php-base
RUN install-php-extensions pdo_mysql pdo_pgsql pdo_sqlite intl zip opcache pcntl

# ---------------------------------------------------------------- vendor
FROM php-base AS vendor
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY composer.json composer.lock ./
# --no-scripts: the app is not copied yet; package discovery runs in the assets stage and the runtime copy.
RUN composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader --no-scripts

# ---------------------------------------------------------------- assets
FROM php-base AS assets
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /app
COPY package.json package-lock.json .npmrc pnpm-workspace.yaml ./
RUN npm ci
COPY --from=vendor /app/vendor ./vendor
COPY . .
# A throwaway env so artisan boots for Wayfinder route generation; nothing from it reaches the runtime image.
RUN cp .env.example .env \
    && php artisan key:generate --force
RUN php artisan package:discover --ansi && npm run build

# ---------------------------------------------------------------- runtime
FROM php-base AS runtime

# The app database is SQLite under a multi-threaded server: WAL lets reads run beside a write,
# IMMEDIATE transactions take the write lock up front (no read-to-write upgrade that fails at once
# with "database is locked"), and the busy timeout makes a request wait for the lock instead.
ENV APP_NAME=DBSuperb \
    APP_ENV=production \
    APP_DEBUG=false \
    LOG_CHANNEL=stderr \
    DB_CONNECTION=sqlite \
    DB_DATABASE=/app/storage/database/database.sqlite \
    DB_TRANSACTION_MODE=IMMEDIATE \
    DB_BUSY_TIMEOUT=5000 \
    DB_JOURNAL_MODE=WAL \
    DBSUPERB_SQLITE_PATHS=/data/sqlite \
    APP_URL=http://localhost:8080 \
    SERVER_NAME=:8080 \
    XDG_CONFIG_HOME=/config \
    XDG_DATA_HOME=/data

WORKDIR /app
COPY --from=vendor /app/vendor ./vendor
COPY . .
COPY --from=assets /app/public/build ./public/build
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Optimized classmap including App\ (the vendor stage ran before the app existed). composer is mounted
# for this one step only and does not stay in the image.
RUN --mount=type=bind,from=composer:2,source=/usr/bin/composer,target=/usr/bin/composer \
    composer dump-autoload --optimize --no-dev --no-interaction

# Non-root user. Application code is owned by root and read-only for it (whatever modes the build host
# gave the context, e.g. 0777 on a Windows drive); only storage, bootstrap/cache and the config/data
# dirs belong to the app user. Storage and the SQLite directory are volume mount points, so they
# (and their ownership) must exist in the image for named volumes to inherit them on first use.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin dbsuperb \
    && chown -R root:root /app \
    && chmod -R u=rwX,go=rX /app \
    && mkdir -p /config /data/caddy /data/sqlite storage/database storage/app/public \
        storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
        bootstrap/cache \
    && (setcap -r /usr/local/bin/frankenphp || true) \
    && chown -R dbsuperb:dbsuperb /app/storage /app/bootstrap/cache /config /data

USER dbsuperb
VOLUME ["/app/storage", "/data/sqlite"]
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/up >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
