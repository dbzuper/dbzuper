# syntax=docker/dockerfile:1

# DBZuper production image: FrankenPHP 1.13 on PHP 8.4, non-root, port 8080 (PORT changes it).
#
# Build-stage choice: the Vite build runs the Wayfinder plugin, which shells out to
# `php artisan wayfinder:generate`, so the asset stage needs PHP *and* Node plus an installed vendor/.
# Rather than juggling separate composer and node images, the asset stage is based on the same
# PHP image as the runtime (extensions already installed, so layers are shared) with the Node 24
# binaries copied in from the official node image. Stages:
#   php-base -> vendor (composer --no-dev) -> assets (node + wayfinder + vite) -> runtime
#   downloads (PGDG signing key, checked; MySQL's mysqldump/mysql, amd64 only) -> runtime
#
# Pinned images (checked 2026-11-23): dunglas/frankenphp:1.13-php8.4 (Debian 13 trixie), composer:2,
# node:24-bookworm-slim, debian:bookworm-slim. Pinned downloads: MySQL 8.4.9 client tarball (sha256) and the
# PostgreSQL apt key (fingerprint).

ARG FRANKENPHP_TAG=1.13-php8.4

# ---------------------------------------------------------------- php-base
FROM dunglas/frankenphp:${FRANKENPHP_TAG} AS php-base
RUN install-php-extensions pdo_mysql pdo_pgsql pdo_sqlite intl zip opcache pcntl bcmath

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

# ---------------------------------------------------------------- downloads
# The PostgreSQL apt repository key, accepted only with its published fingerprint.
# MySQL's mysqldump/mysql for native backups of MySQL servers. Oracle's apt package conflicts with
# mariadb-client, so only the two clients and the libraries they need come from Oracle's minimal tarball
# (an archived, permanent URL; checked against its sha256). It exists for x86_64 only (no small ARM build), so
# other platforms get an empty /opt/mysql and MySQL servers use the built-in method there. The mysql client links
# ncurses 5, which Debian 13 no longer ships: bookworm's copy goes next to the binaries (found through their RPATH).
FROM debian:bookworm-slim AS downloads
ARG TARGETARCH
ARG PGDG_KEY_FINGERPRINT=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
ARG MYSQL_CLIENT_VERSION=8.4.9
ARG MYSQL_CLIENT_SHA256=1e9f341e36d4fcdbb3e4d7d3dae6d6b2a42ebe8333e8f276c25e25564ce565c1
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils \
    && curl -fsSL -o /pgdg.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && gpg --show-keys --with-colons /pgdg.asc | grep -qx "fpr:::::::::${PGDG_KEY_FINGERPRINT}:" \
    && mkdir -p /opt/mysql \
    && if [ "$TARGETARCH" = "amd64" ]; then \
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libncurses5 libtinfo5 \
        && curl -fsSL -o /tmp/mysql.tar.xz "https://cdn.mysql.com/archives/mysql-8.4/mysql-${MYSQL_CLIENT_VERSION}-linux-glibc2.17-x86_64-minimal.tar.xz" \
        && echo "${MYSQL_CLIENT_SHA256}  /tmp/mysql.tar.xz" | sha256sum -c - \
        && tar -xJf /tmp/mysql.tar.xz -C /opt/mysql --strip-components=1 --wildcards \
            '*/bin/mysql' '*/bin/mysqldump' '*/lib/private/libssl.so*' '*/lib/private/libcrypto.so*' \
        && cp -a /lib/x86_64-linux-gnu/libncurses.so.5* /lib/x86_64-linux-gnu/libtinfo.so.5* /opt/mysql/lib/private/ \
        && rm /tmp/mysql.tar.xz; \
    fi \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------- runtime
FROM php-base AS runtime

# Native backup and restore tools (docs/self-hosting.md, "Native tools"): pg_dump/psql 18 from the PostgreSQL
# apt repository (a newer pg_dump dumps older servers; Debian's own is older), mariadb-dump/mariadb from Debian,
# and MySQL's clients from the stage above. /usr/local/bin comes first on PATH, so MySQL's mysqldump/mysql and
# PostgreSQL 18's tools win over Debian's wrappers and compatibility names. No sqlite3: SQLite always uses built-in.
COPY --from=downloads /pgdg.asc /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
RUN . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-client-18 mariadb-client \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/lib/postgresql/18/bin/pg_dump /usr/lib/postgresql/18/bin/psql /usr/local/bin/
COPY --from=downloads /opt/mysql /opt/mysql
RUN if [ -x /opt/mysql/bin/mysqldump ]; then ln -s /opt/mysql/bin/mysqldump /opt/mysql/bin/mysql /usr/local/bin/; fi

# Restore pieces are raw PUT bodies of at most 8 MiB; Laravel refuses bodies above post_max_size (see the file).
COPY docker/php.ini "$PHP_INI_DIR/conf.d/zz-dbzuper.ini"

# The app database is SQLite under a multi-threaded server: WAL lets reads run beside a write,
# IMMEDIATE transactions take the write lock up front (no read-to-write upgrade that fails at once
# with "database is locked"), and the busy timeout makes a request wait for the lock instead.
ENV APP_NAME=DBZuper \
    APP_ENV=production \
    APP_DEBUG=false \
    LOG_CHANNEL=stderr \
    DB_CONNECTION=sqlite \
    DB_DATABASE=/app/storage/database/database.sqlite \
    DB_TRANSACTION_MODE=IMMEDIATE \
    DB_BUSY_TIMEOUT=5000 \
    DB_JOURNAL_MODE=WAL \
    DBZUPER_SQLITE_PATHS=/data/sqlite \
    DBZUPER_IN_CONTAINER=1 \
    PORT=8080 \
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
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin dbzuper \
    && chown -R root:root /app \
    && chmod -R u=rwX,go=rX /app \
    && mkdir -p /config /data/caddy /data/sqlite storage/database storage/app/public \
        storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
        bootstrap/cache \
    && (setcap -r /usr/local/bin/frankenphp || true) \
    && chown -R dbzuper:dbzuper /app/storage /app/bootstrap/cache /config /data

USER dbzuper
VOLUME ["/app/storage", "/data/sqlite"]
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/up" >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
