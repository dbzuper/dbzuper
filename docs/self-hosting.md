# Self-hosting DBSuperb

DBSuperb ships as a single Docker image (FrankenPHP 1.13 on PHP 8.4, running as a non-root user) that listens on plain HTTP port 8080. Put a reverse proxy in front of it for HTTPS.

## Requirements

- Docker with the Compose plugin (v2.24 or newer, for the optional `env_file`).
- About 750 MB of disk for the image, plus space for your SQLite files and the app database.
- Network access from the container to the databases you want to explore.

## Quick start

    git clone <repository-url> dbsuperb && cd dbsuperb
    docker compose up -d --build

Wait for the container to become healthy (`docker compose ps`, or `curl http://localhost:8080/up` returns 200), then create the administrator (below) and open <http://localhost:8080>.

On first start the entrypoint creates the storage directories and the application SQLite database, generates an `APP_KEY` (see [Backups](#backups-and-the-app_key)), runs the migrations and caches the configuration, routes and views. Every later start repeats the migrations and caching, so upgrades need no manual step.

One-off commands run through the same entrypoint (key, storage and database prepared, server not started): `docker compose run --rm app php artisan --version`.

Build and run without Compose:

    docker build -t dbsuperb:local .
    docker run -d -p 8080:8080 -v dbsuperb-storage:/app/storage -v dbsuperb-sqlite:/data/sqlite dbsuperb:local

## First administrator

DBSuperb has a single administrator. Either open the app: until an administrator exists every page redirects to the setup screen. Or create it from the command line before exposing the port:

    docker compose exec app php artisan dbsuperb:install --name="Admin" --email=admin@example.com --password='Str0ng-passphrase' --no-interaction

Without options the command prompts for each value. In production the password must be at least 12 characters with upper and lower case letters, a number and a symbol, and must not appear in known data breaches. The breach check queries haveibeenpwned.com: on a host that silently drops outbound traffic the command or setup form can stall for up to about 30 seconds before the check fails open and the password is accepted. **The setup screen is public until the first administrator exists**, so create the account before publishing the service to a network.

## Configuration

Compose reads an optional `.env.docker` next to `docker-compose.yml` (plain `KEY=value` lines) and passes it to the container. Set `APP_URL` there too (the image default is `http://localhost:8080`); nothing in `docker-compose.yml` overrides it, and variables from your shell or a project `.env` are not passed in. Environment changes apply on `docker compose up -d` or a restart: the configuration is cached from the environment at every start.

The image defaults are `APP_ENV=production`, `APP_DEBUG=false`, `LOG_CHANNEL=stderr` (read logs with `docker compose logs app`), `DB_CONNECTION=sqlite`, `DB_DATABASE=/app/storage/database/database.sqlite` and `DBSUPERB_SQLITE_PATHS=/data/sqlite`.

## Adding SQLite files

SQLite connections may only open files inside the directories listed in `DBSUPERB_SQLITE_PATHS` (comma-separated). The image points it at `/data/sqlite`, which is the `dbsuperb-sqlite` volume. Copy a database in and connect to its in-container path:

    docker compose cp ./shop.sqlite app:/data/sqlite/shop.sqlite
    docker compose exec --user root app chown 10001:10001 /data/sqlite/shop.sqlite

Then add a connection with driver SQLite and database `/data/sqlite/shop.sqlite`. The container user is `dbsuperb` (uid 10001): the file must be readable by it (and writable, unless the connection is read-only). To explore a directory on the host instead, bind-mount it, for example `./databases:/data/sqlite` in the `volumes` of the `app` service, and make it readable for uid 10001.

The same applies to a bind-mounted storage directory (`./storage:/app/storage`): if it is owned by root the container cannot write to it, and the entrypoint fails with `Permission denied` (or the app returns 500s). Fix it on the host with `sudo chown -R 10001:10001 ./storage`.

## HTTPS behind a reverse proxy

Terminate TLS in a reverse proxy and forward to port 8080. Set, in `.env.docker`:

    APP_URL=https://db.example.com
    TRUSTED_PROXIES=*
    SESSION_SECURE_COOKIE=true

`TRUSTED_PROXIES` takes comma-separated IPs or CIDRs of your proxy, or `*` to trust whoever calls the container. Leave it unset when the container is reached directly: no `X-Forwarded-*` header is then trusted.

With a published port (`8080:8080`), a proxy running on the Docker host does **not** reach the container from `127.0.0.1`: connections arrive from the Docker network gateway. Find the CIDR and trust exactly that:

    docker network inspect $(docker compose ps -q app | xargs docker inspect -f '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}') -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'

and set, for example, `TRUSTED_PROXIES=172.18.0.0/16`. Also bind the published port to loopback so only the host can reach it: `ports: ["127.0.0.1:8080:8080"]`. Use `*` only when the proxy is the sole possible caller (for example a proxy container on a private Docker network with no published port).

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

The `dbsuperb-storage` volume (`/app/storage`) holds the application database (users, saved connections, history, layouts), sessions, logs and, unless you pass `APP_KEY` yourself, the generated key in `storage/app.key`. Back the whole volume up; for a consistent copy stop the container first:

    docker compose stop app
    docker run --rm -v dbsuperb_dbsuperb-storage:/s -v "$PWD":/b alpine tar czf /b/dbsuperb-storage.tgz -C /s .
    docker compose start app

(The volume name is prefixed with the Compose project name, normally the directory name; check `docker volume ls`.) To restore into an empty volume:

    docker compose stop app
    docker run --rm -v dbsuperb_dbsuperb-storage:/s -v "$PWD":/b alpine sh -c 'rm -rf /s/* /s/.[!.]* ; tar xzf /b/dbsuperb-storage.tgz -C /s && chown -R 10001:10001 /s'
    docker compose start app

Back up `dbsuperb-sqlite` the same way if it holds your only copy of the SQLite files.

**Saved connection passwords are encrypted with `APP_KEY`. If the key is lost, saved credentials cannot be decrypted** and each connection's password must be re-entered. To control the key yourself, set `APP_KEY=base64:...` in `.env.docker` (generate one with `docker compose run --rm --no-deps app php artisan key:generate --show`); a supplied key takes precedence over `storage/app.key`. Restoring a backup restores the key with it.

## Upgrades

    git pull
    docker compose up -d --build

The volumes survive, the entrypoint runs `php artisan migrate --force` on start, and the key is reused. Take a backup first.

## Environment reference

| Variable                         | Default                     | Meaning                                                                                                  |
| -------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DBSUPERB_SQLITE_PATHS`          | `/data/sqlite` in the image | Comma-separated directories SQLite connection files must live in.                                        |
| `DBSUPERB_CONNECT_TIMEOUT`       | `5`                         | Seconds to wait when opening a connection to a database server.                                          |
| `DBSUPERB_INTROSPECTION_TIMEOUT` | `30`                        | Seconds allowed for loading a schema.                                                                    |
| `DBSUPERB_QUERY_TIMEOUT`         | `15`                        | Seconds a SQL editor statement may run (not enforced on SQLite or for non-`SELECT` statements on MySQL). |
| `DBSUPERB_SCHEMA_MAX_OBJECTS`    | `5000`                      | Most tables and views kept in a schema snapshot.                                                         |
| `DBSUPERB_HISTORY_KEEP`          | `5000`                      | Query history entries kept per connection.                                                               |
| `TRUSTED_PROXIES`                | unset                       | Reverse proxies whose `X-Forwarded-*` headers are trusted (IPs/CIDRs or `*`).                            |
| `APP_URL`                        | `http://localhost:8080`     | Public URL of the app (set in `.env.docker`).                                                            |
| `APP_KEY`                        | generated into the volume   | Encryption key; see above.                                                                               |
| `SESSION_SECURE_COOKIE`          | unset                       | Set `true` when served over HTTPS.                                                                       |

## Security notes

- Only the administrator can sign in and create connections, but DBSuperb connects to **any host reachable from the container**, including your internal network. Do not expose it to people you would not give that reach.
- Saved credentials are encrypted at rest with `APP_KEY`; anyone holding both the storage volume and the key can read them. Treat backups accordingly.
- Serve it over HTTPS and keep the container port off the public network.
- SQLite files are opened only inside `DBSUPERB_SQLITE_PATHS`; `ATTACH`, `VACUUM INTO` and similar are refused.
- Query history stores SQL as typed (password literals in `PASSWORD`/`IDENTIFIED BY` clauses are redacted). Turn history off per connection for sensitive work.
