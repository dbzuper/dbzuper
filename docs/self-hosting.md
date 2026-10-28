# Self-hosting DBZuper

DBZuper ships as a single Docker image (FrankenPHP 1.13 on PHP 8.4, running as a non-root user) that listens on plain HTTP port 8080. Put a reverse proxy in front of it for HTTPS.

## Requirements

- Docker with the Compose plugin (v2.24 or newer, for the optional `env_file`).
- About 750 MB of disk for the image, plus space for your SQLite files and the app database.
- Network access from the container to the databases you want to explore.

## Quick start

    git clone <repository-url> dbzuper && cd dbzuper
    docker compose up -d --build --wait

`--wait` returns once the container is healthy (or check `docker compose ps`, or that `curl http://localhost:8080/up` returns 200). Then create the administrator (below) and open <http://localhost:8080>.

On first start the entrypoint creates the storage directories and the application SQLite database, generates an `APP_KEY` (see [Backups](#backups-and-the-app_key)), runs the migrations and caches the configuration, routes and views. Every later start repeats the migrations and caching, so upgrades need no manual step.

One-off commands run through the same entrypoint (key, storage and database prepared, server not started): `docker compose run --rm app php artisan --version`.

Build and run without Compose:

    docker build -t dbzuper:local .
    docker run -d -p 8080:8080 -v dbzuper-storage:/app/storage -v dbzuper-sqlite:/data/sqlite dbzuper:local

## First administrator

DBZuper has a single administrator. Either open the app: until an administrator exists every page redirects to the setup screen. Or create it from the command line before exposing the port:

    docker compose exec app php artisan dbzuper:install --name="Admin" --email=admin@example.com --password='Str0ng-passphrase' --no-interaction

Without options the command prompts for each value. In production the password must be at least 12 characters with upper and lower case letters, a number and a symbol, and must not appear in known data breaches. The breach check queries haveibeenpwned.com: on a host that silently drops outbound traffic the command or setup form can stall for up to about 30 seconds before the check fails open and the password is accepted. **The setup screen is public until the first administrator exists**, so create the account before publishing the service to a network.

## Configuration

Compose reads an optional `.env.docker` next to `docker-compose.yml` (plain `KEY=value` lines) and passes it to the container. Set `APP_URL` there too (the image default is `http://localhost:8080`); nothing in `docker-compose.yml` overrides it, and variables from your shell or a project `.env` are not passed in. Environment changes apply on `docker compose up -d` or a restart: the configuration is cached from the environment at every start.

The image defaults are `APP_NAME=DBZuper`, `APP_ENV=production`, `APP_DEBUG=false`, `LOG_CHANNEL=stderr` (read logs with `docker compose logs app`), `DB_CONNECTION=sqlite`, `DB_DATABASE=/app/storage/database/database.sqlite`, `DB_JOURNAL_MODE=WAL`, `DB_TRANSACTION_MODE=IMMEDIATE`, `DB_BUSY_TIMEOUT=5000` and `DBZUPER_SQLITE_PATHS=/data/sqlite`. The three SQLite lock settings let the multi-threaded server share the application database without "database is locked" errors; keep them.

## Adding SQLite files

SQLite connections may only open files inside the directories listed in `DBZUPER_SQLITE_PATHS` (comma-separated). The image points it at `/data/sqlite`, which is the `dbzuper-sqlite` volume. Copy a database in and connect to its in-container path:

    docker compose cp ./shop.sqlite app:/data/sqlite/shop.sqlite
    docker compose exec --user root app chown 10001:10001 /data/sqlite/shop.sqlite

Then add a connection with driver SQLite and database `/data/sqlite/shop.sqlite`. The container user is `dbzuper` (uid 10001): the file must be readable by it (and writable, unless the connection is read-only). To explore a directory on the host instead, bind-mount it, for example `./databases:/data/sqlite` in the `volumes` of the `app` service, and make it readable for uid 10001.

The same applies to a bind-mounted storage directory (`./storage:/app/storage`): if it is owned by root the container cannot write to it, and the entrypoint fails with `Permission denied` (or the app returns 500s). Fix it on the host with `sudo chown -R 10001:10001 ./storage`.

## HTTPS behind a reverse proxy

Terminate TLS in a reverse proxy and forward to port 8080. With a published port (`8080:8080`), a proxy running on the Docker host does **not** reach the container from `127.0.0.1`: connections arrive from the gateway of the container's Docker bridge network. Find that network's CIDR:

    docker network inspect $(docker compose ps -q app | xargs docker inspect -f '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}') -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'

and trust exactly that. Set, in `.env.docker` (with your CIDR):

    APP_URL=https://db.example.com
    TRUSTED_PROXIES=172.18.0.0/16
    SESSION_SECURE_COOKIE=true

Also bind the published port to loopback so only the host (and its proxy) can reach it: `ports: ["127.0.0.1:8080:8080"]` in `docker-compose.yml`.

`TRUSTED_PROXIES` takes comma-separated IPs or CIDRs of your proxy. Leave it unset when the container is reached directly: no `X-Forwarded-*` header is then trusted. `TRUSTED_PROXIES=*` trusts whoever calls the container, so anyone who can reach port 8080 could fake their IP address and the HTTPS flag. Use `*` only when the proxy is the sole possible caller: the port is bound to loopback as above, or not published at all (a proxy container on a private Docker network).

Caddy:

    db.example.com {
        encode zstd gzip
        reverse_proxy 127.0.0.1:8080
    }

nginx:

    server {
        listen 443 ssl;
        server_name db.example.com;
        # ssl_certificate / ssl_certificate_key ...

        location / {
            proxy_pass http://127.0.0.1:8080;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Port $server_port;
            client_max_body_size 25m;
        }
    }

## Backups and the APP_KEY

The `dbzuper-storage` volume (`/app/storage`) holds the application database (users, saved connections, history, layouts), sessions, logs and, unless you pass `APP_KEY` yourself, the generated key in `storage/app.key`. Back the whole volume up; for a consistent copy stop the container first:

    docker compose stop app
    docker run --rm -v dbzuper_dbzuper-storage:/s -v "$PWD":/b alpine tar czf /b/dbzuper-storage.tgz -C /s .
    docker compose start app

(The volume name is prefixed with the Compose project name, normally the directory name; check `docker volume ls`.) To restore into an empty volume:

    docker compose stop app
    docker run --rm -v dbzuper_dbzuper-storage:/s -v "$PWD":/b alpine sh -c 'rm -rf /s/* /s/.[!.]* ; tar xzf /b/dbzuper-storage.tgz -C /s && chown -R 10001:10001 /s'
    docker compose start app

Back up `dbzuper-sqlite` the same way if it holds your only copy of the SQLite files.

**Saved connection passwords are encrypted with `APP_KEY`. If the key is lost or replaced, saved credentials cannot be decrypted** and each connection's password must be re-entered. Restoring a backup restores the key with it.

- **Default:** leave `APP_KEY` unset. On first start the container generates a key, keeps it in `storage/app.key` in the storage volume and reuses it on every restart and upgrade. Back it up with the volume, or on its own: `docker compose exec app cat storage/app.key`.
- **Pinning the key in `.env.docker` on an existing install:** adopt the key the container already uses, never a new one. Print it with

      docker compose exec app cat storage/app.key

    and put that value in `.env.docker` as `APP_KEY=base64:...`. A supplied key takes precedence over `storage/app.key`, so a **different** key makes every saved password unreadable.

- **Pinning the key on a brand-new install:** generate it **before the first start**, so the container never creates its own:

      docker compose build
      docker run --rm --entrypoint php dbzuper:local artisan key:generate --show

    Do not use `docker compose run --rm app php artisan key:generate --show` for this: the one-off container goes through the entrypoint, which on a fresh volume first writes a **different** key to `storage/app.key`.

## Upgrades

    git pull
    docker compose up -d --build

The volumes survive, the entrypoint runs `php artisan migrate --force` on start, and the key is reused. Take a backup first. Changes users will notice (such as the dark default theme, which keeps an appearance already saved in the browser) are listed under "Upgrading" in the README.

## Environment reference

| Variable                         | Default                     | Meaning                                                                                                  |
| -------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `APP_NAME`                       | `DBZuper` in the image     | Name in the page title, sidebar, session cookie and two-factor issuer.                                   |
| `DBZUPER_SQLITE_PATHS`          | `/data/sqlite` in the image | Comma-separated directories SQLite connection files must live in.                                        |
| `DBZUPER_CONNECT_TIMEOUT`       | `5`                         | Seconds to wait when opening a connection to a database server.                                          |
| `DBZUPER_INTROSPECTION_TIMEOUT` | `30`                        | Seconds allowed for loading a schema.                                                                    |
| `DBZUPER_QUERY_TIMEOUT`         | `15`                        | Seconds a SQL editor statement may run (not enforced on SQLite or for non-`SELECT` statements on MySQL). |
| `DBZUPER_SCHEMA_MAX_OBJECTS`    | `5000`                      | Most tables and views kept in a schema snapshot.                                                         |
| `DBZUPER_HISTORY_KEEP`          | `5000`                      | Query history entries kept per connection.                                                               |
| `TRUSTED_PROXIES`                | unset                       | Reverse proxies whose `X-Forwarded-*` headers are trusted (IPs/CIDRs or `*`).                            |
| `APP_URL`                        | `http://localhost:8080`     | Public URL of the app (set in `.env.docker`).                                                            |
| `APP_KEY`                        | generated into the volume   | Encryption key; see above.                                                                               |
| `SESSION_SECURE_COOKIE`          | unset                       | Set `true` when served over HTTPS.                                                                       |
| `DB_JOURNAL_MODE`                | `WAL` in the image          | SQLite journal mode of the application database (unset: SQLite's default).                               |
| `DB_TRANSACTION_MODE`            | `IMMEDIATE` in the image    | How SQLite transactions on the application database start (`DEFERRED` outside the image).                |
| `DB_BUSY_TIMEOUT`                | `5000`                      | Milliseconds a request waits for the SQLite lock before failing with "database is locked".               |

## Troubleshooting

- **`SQLSTATE[HY000]: General error: 5 database is locked`** in `docker compose logs app`: the application database is SQLite and the server handles requests in parallel. Check that `DB_JOURNAL_MODE`, `DB_TRANSACTION_MODE` and `DB_BUSY_TIMEOUT` are not overridden in `.env.docker` (`docker compose exec app env | grep ^DB_`) and that the storage volume is on a local disk (SQLite locking is unreliable over network file systems). To check a deployment, sign in, copy the session cookie (`dbzuper-session`) from the browser and fire parallel requests, for example 64 schema reads, 16 at a time:

      seq 64 | xargs -P16 -I{} curl -s -o /dev/null -w '%{http_code}\n' -b 'dbzuper-session=<value>' http://localhost:8080/api/c/1/schema | sort | uniq -c

    Every response should be `200`, and `docker compose logs app | grep -c "database is locked"` should print `0`.

## Security notes

- Only the administrator can sign in and create connections, but DBZuper connects to **any host reachable from the container**, including your internal network. Do not expose it to people you would not give that reach.
- Saved credentials are encrypted at rest with `APP_KEY`; anyone holding both the storage volume and the key can read them. Treat backups accordingly.
- Serve it over HTTPS and keep the container port off the public network.
- SQLite files are opened only inside `DBZUPER_SQLITE_PATHS`; `ATTACH`, `VACUUM INTO` and similar are refused.
- Query history stores SQL as typed (password literals in `PASSWORD`/`IDENTIFIED BY` clauses are redacted). Turn history off per connection for sensitive work.
