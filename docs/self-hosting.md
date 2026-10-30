# Self-hosting DBZuper

DBZuper ships as a single Docker image (FrankenPHP 1.13 on PHP 8.4, running as a non-root user) that listens on plain HTTP port 8080. Put a reverse proxy in front of it for HTTPS.

## Requirements

- Docker. The Compose plugin (v2.24 or newer, for the optional `env_file`) is only needed to build from source or to use Compose.
- About 750 MB of disk for the image, plus space for your SQLite files and the app database.
- Network access from the container to the databases you want to explore.

## Quick start

With the published image (linux/amd64 and linux/arm64):

    docker run -d --name dbzuper -p 8080:8080 --restart unless-stopped \
      --add-host=host.docker.internal:host-gateway \
      -v dbzuper-storage:/app/storage -v dbzuper-sqlite:/data/sqlite \
      ghcr.io/dbzuper/dbzuper:latest

Then open <http://localhost:8080> and create the administrator with the setup code from `docker logs dbzuper` (see [First administrator](#first-administrator)). Pin a version (`ghcr.io/dbzuper/dbzuper:1.2`) instead of `latest` if you want upgrades to be deliberate.

### With Docker Compose

1. Make a directory for the install, for example `~/dbzuper`, and save this in it as `docker-compose.yml`:

       services:
           app:
               image: ghcr.io/dbzuper/dbzuper:latest
               ports: ['8080:8080']
               extra_hosts: ['host.docker.internal:host-gateway']
               env_file: [{ path: .env.docker, required: false }]
               volumes: ['dbzuper-storage:/app/storage', 'dbzuper-sqlite:/data/sqlite']
               restart: unless-stopped
       volumes:
           dbzuper-storage:
           dbzuper-sqlite:

2. Optionally, put settings in a `.env.docker` next to it, one `KEY=value` per line. For a private install on your own computer, for example:

       # Any password of 8+ characters (see First administrator).
       DBZUPER_PASSWORD_POLICY=basic

    Behind a domain, set `APP_URL=https://dbzuper.example.com` and `SESSION_SECURE_COOKIE=true` here too. Every variable is listed in the [Environment reference](#environment-reference).

3. Start it, wait until it is healthy, and print the setup code:

       docker compose up -d --wait
       docker compose logs app | grep "setup code"

4. Open <http://localhost:8080>, enter the setup code and create the administrator.

Day to day, from the same directory:

    docker compose ps                            # status
    docker compose logs -f app                   # follow the log
    docker compose pull && docker compose up -d  # upgrade to the latest image
    docker compose down                          # stop and remove the container; the volumes and data stay

Do not add `-v` to `docker compose down` unless you mean to delete all data: it removes the volumes too (see [Where your data lives](#where-your-data-lives)). To keep the data in normal folders instead of volumes, see [Using a normal folder instead](#using-a-normal-folder-instead).

### From source

To build the image yourself, use the `docker-compose.yml` in the repository:

    git clone https://github.com/dbzuper/dbzuper && cd dbzuper
    docker compose up -d --build --wait

`--wait` returns once the container is healthy (or check `docker compose ps`, or that `curl http://localhost:8080/up` returns 200). The setup code is in `docker compose logs app`.

### Choosing the port

DBZuper answers on port 8080 by default. To use another port on your server, change the **host** side of the mapping
and tell the container which port that is, so the address it prints (and `APP_URL`) matches:

    docker run ... -p 3000:8080 -e DBZUPER_PORT=3000 ghcr.io/dbzuper/dbzuper:latest
    DBZUPER_PORT=3000 docker compose up -d     # or DBZUPER_PORT=3000 in a .env next to docker-compose.yml

The container keeps listening on 8080 inside, which is all a published port needs. Only when there is no port mapping
(`--network host`, or a platform that assigns the port) set `PORT` instead, the port the server itself listens on:
`docker run --network host -e PORT=3000 ...`. `PORT` must be 1024 or higher, because the server runs as a non-root user.
Behind a reverse proxy with its own domain, set `APP_URL` (see [HTTPS behind a reverse proxy](#https-behind-a-reverse-proxy));
an explicit `APP_URL` always wins.

On first start the entrypoint creates the storage directories and the application SQLite database, generates an `APP_KEY` (see [Backups](#backups-and-the-app_key)), runs the migrations and caches the configuration, routes and views. Every later start repeats the migrations and caching, so upgrades need no manual step.

One-off commands run through the same entrypoint (key, storage and database prepared, server not started): `docker compose run --rm app php artisan --version`, or `docker exec dbzuper php artisan --version` on a running container.

### Where your data lives

`-v dbzuper-storage:/app/storage` attaches a **named volume**: a directory Docker creates and manages, mounted at `/app/storage` inside the container. It survives stopping, removing and upgrading the container, which is why the data is kept across `docker pull` and a new `docker run`.

| Volume            | In the container | Holds                                                                                                                              |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `dbzuper-storage` | `/app/storage`   | The application database (users, saved connections, history, layouts), sessions, logs and `app.key`.                               |
| `dbzuper-sqlite`  | `/data/sqlite`   | SQLite files you want to browse; the only directory SQLite connections may open (see [Adding SQLite files](#adding-sqlite-files)). |

Compose prefixes volume names with the project name, which is the directory name unless you set one, so the same volumes are `dbzuper_dbzuper-storage` and `dbzuper_dbzuper-sqlite` there. `docker volume ls` lists them, and `docker volume inspect dbzuper-storage` prints the directory behind one as `Mountpoint`:

- **Linux (Docker Engine):** `/var/lib/docker/volumes/dbzuper-storage/_data`, owned by root.
- **Docker Engine inside WSL:** the same path inside the WSL distribution. From Windows Explorer it is `\\wsl$\<distro>\var\lib\docker\volumes\dbzuper-storage\_data` (for example `\\wsl$\Ubuntu\...`), though root ownership may stop Explorer from opening it.
- **Docker Desktop (Windows, macOS):** the path is inside Docker Desktop's own virtual machine and is not a folder on your disk. Use the Volumes tab in Docker Desktop, or the commands below.

Rather than editing a volume's directory by hand, go through the container:

    docker exec dbzuper ls -la /data/sqlite               # list a volume's contents
    docker cp ./shop.sqlite dbzuper:/data/sqlite/         # copy a file in
    docker cp dbzuper:/app/storage ./storage-copy         # copy a directory out

`docker volume rm dbzuper-storage`, `docker compose down -v` and `docker system prune --volumes` delete the volume and everything in it, including the key that decrypts saved passwords. Take a [backup](#backups-and-the-app_key) first.

### Using a normal folder instead

To keep the data in a folder you can open directly, give `-v` a path instead of a name (a **bind mount**). The container runs as uid 10001, so that user must own the folders:

    mkdir -p ~/dbzuper/storage ~/dbzuper/sqlite
    sudo chown -R 10001:10001 ~/dbzuper

    docker run -d --name dbzuper -p 8080:8080 --restart unless-stopped \
      --add-host=host.docker.internal:host-gateway \
      -v ~/dbzuper/storage:/app/storage -v ~/dbzuper/sqlite:/data/sqlite \
      ghcr.io/dbzuper/dbzuper:latest

With Compose, use relative paths and drop the top-level `volumes:` block:

            volumes: ['./storage:/app/storage', './sqlite:/data/sqlite']

Files you add to the folder later must be readable by uid 10001 too, and writable unless the connection is read-only (`sudo chown 10001:10001 ~/dbzuper/sqlite/shop.sqlite`). If the storage folder is owned by root, the container cannot write to it and the entrypoint fails with `Permission denied`.

Keep the storage folder on a local Linux disk. With Docker inside WSL, use a folder in the WSL file system (`~/dbzuper`, reachable from Windows as `\\wsl$\<distro>\home\<you>\dbzuper`), not one under `/mnt/c`: Windows drives mounted into WSL are slow, and the locking SQLite relies on is unreliable there.

## First administrator

DBZuper has a single administrator. Until one exists every page redirects to the setup screen, which asks for a one-time **setup code** so nobody else who can reach the port can claim the install. The container prints the code when it starts:

    docker compose logs app | grep "setup code"
    # Open http://localhost:8080/setup and enter the setup code K7QM-4XRT-9PWD

or show it at any time with `docker compose exec app php artisan dbzuper:setup-code`. Case, spaces and dashes don't matter. The code stays the same until the administrator is created, then it is deleted.

You can also create the administrator from the command line, which needs no code:

    docker compose exec app php artisan dbzuper:install --name="Admin" --email=admin@example.com --password='Str0ng-passphrase' --no-interaction

Without options the command prompts for each value. In production the password must be at least 12 characters with upper and lower case letters, a number and a symbol, and must not appear in known data breaches. The breach check queries haveibeenpwned.com: on a host that silently drops outbound traffic the command or setup form can stall for up to about 30 seconds before the check fails open and the password is accepted.

For a private install only you can reach, such as one on your own computer, set `DBZUPER_PASSWORD_POLICY=basic` in `.env.docker` (or `-e DBZUPER_PASSWORD_POLICY=basic` with `docker run`) and restart the container. Passwords then need only 8 characters, and the breach check is skipped. Keep the default `strong` on any install other people can reach over a network. The policy applies when a password is set or changed, so existing passwords keep working either way.

## Resetting a forgotten password

Out of the box DBZuper sends no email, so the login page has no reset link. It says "Forgot your password? Ask your server admin to reset it." instead: whoever can run commands on the server sets a new password with

    docker compose exec app php artisan dbzuper:reset-password

(`docker exec -it dbzuper php artisan dbzuper:reset-password` with `docker run`, `php artisan dbzuper:reset-password` without Docker). It prompts for the new password twice, or takes `--password='…'`, and follows the same [password policy](#first-administrator). Every browser signed in to the account is signed out. With a single account no email is needed; if there are several, pass the one to reset: `dbzuper:reset-password admin@example.com`.

If two-factor authentication is on and the authenticator app and recovery codes are lost too, add `--reset-2fa`. It turns two-factor authentication off and removes the account's passkeys; set them up again under **Settings → Security** after signing in.

### Reset links by email

To let people reset their own password, give DBZuper an SMTP server in `.env.docker` and restart the container:

    MAIL_MAILER=smtp
    MAIL_HOST=smtp.example.com
    MAIL_PORT=587
    MAIL_USERNAME=dbzuper@example.com
    MAIL_PASSWORD=app-password
    MAIL_FROM_ADDRESS=dbzuper@example.com

The login page then shows **Forgot your password?**, which emails a reset link to the account's address. Set `APP_URL` to the address people open, since the link is built from it. Any `MAIL_MAILER` other than `log` turns the link on; `dbzuper:reset-password` keeps working either way.

## Configuration

Compose reads an optional `.env.docker` next to `docker-compose.yml` (plain `KEY=value` lines) and passes it to the container. Set `APP_URL` there too (by default it is `http://localhost:` plus `DBZUPER_PORT`, else `PORT`, else 8080); nothing in `docker-compose.yml` overrides it, and other variables from your shell or a project `.env` are not passed in. `DBZUPER_PORT` is the exception: Compose reads it from your shell or a `.env` next to `docker-compose.yml` to publish the port, so set it there, not in `.env.docker`. Environment changes apply on `docker compose up -d` or a restart: the configuration is cached from the environment at every start.

The image defaults are `APP_NAME=DBZuper`, `APP_ENV=production`, `APP_DEBUG=false`, `LOG_CHANNEL=stderr` (read logs with `docker compose logs app`), `DB_CONNECTION=sqlite`, `DB_DATABASE=/app/storage/database/database.sqlite`, `DB_JOURNAL_MODE=WAL`, `DB_TRANSACTION_MODE=IMMEDIATE`, `DB_BUSY_TIMEOUT=5000` and `DBZUPER_SQLITE_PATHS=/data/sqlite`. The three SQLite lock settings let the multi-threaded server share the application database without "database is locked" errors; keep them.

## Connecting to a database on the same computer

Inside the container, `localhost` and `127.0.0.1` are the DBZuper container itself, not the computer running Docker. To connect to a database server running on that computer, use the host `host.docker.internal`. Docker Desktop provides that name; on Linux the `extra_hosts` entry in `docker-compose.yml` maps it to the host (with `docker run`, add `--add-host=host.docker.internal:host-gateway`). The connection form shows this hint when you type a local address.

The database server must also accept connections from the Docker network, not only from `127.0.0.1`: MySQL and MariaDB listen on localhost only when `bind-address = 127.0.0.1`, and PostgreSQL needs `listen_addresses` and a matching `pg_hba.conf` entry.

The database user must be allowed to sign in from the container's address too. A MySQL or MariaDB account is tied to a host: `root@localhost`, the default on XAMPP, Laragon, MAMP and Homebrew installs, only accepts connections from the same machine, so the server answers "Host '172.x.x.x' is not allowed to connect". Create an account for DBZuper that may connect from elsewhere, and grant it only what you need:

    CREATE USER 'dbzuper'@'%' IDENTIFIED BY 'a-strong-password';
    GRANT ALL PRIVILEGES ON *.* TO 'dbzuper'@'%';

`%` means any host. On a shared network, narrow it to the Docker subnet, for example `'dbzuper'@'172.%'`. For PostgreSQL, add a `pg_hba.conf` line such as `host all all 172.16.0.0/12 scram-sha-256` and reload the server.

A firewall on the computer can still drop the connection. On Windows, allow inbound TCP on the database port (3306 for MySQL and MariaDB, 5432 for PostgreSQL) from the Docker or WSL network.

### Docker inside WSL, database on Windows

If Docker Engine runs inside a WSL distribution (not Docker Desktop) and the database runs on Windows, `host.docker.internal` points at the WSL virtual machine, not at Windows. Two ways to reach Windows:

- Use the Windows address as seen from WSL. Print it in WSL with `ip route show default | awk '{print $3}'` (for example `172.20.144.1`) and enter it as the host. The address can change when WSL restarts.
- Turn on mirrored networking so WSL shares the Windows network. Add this to `%UserProfile%\.wslconfig`, then run `wsl --shutdown`:

      [wsl2]
      networkingMode=mirrored

    Then run the container with host networking (`network_mode: host` in Compose, `--network host` with `docker run`) and connect to `127.0.0.1`. With host networking the container uses the WSL network directly, so `ports` is ignored and DBZuper listens on port 8080 of WSL, which mirrored mode shares with Windows.

## Adding SQLite files

SQLite connections may only open files inside the directories listed in `DBZUPER_SQLITE_PATHS` (comma-separated). The image points it at `/data/sqlite`, which is the `dbzuper-sqlite` volume. Copy a database in and connect to its in-container path:

    docker compose cp ./shop.sqlite app:/data/sqlite/shop.sqlite
    docker compose exec --user root app chown 10001:10001 /data/sqlite/shop.sqlite

Then add a connection with driver SQLite and database `/data/sqlite/shop.sqlite`. The container user is `dbzuper` (uid 10001): the file must be readable by it (and writable, unless the connection is read-only). To explore a directory on the host instead, bind-mount it, for example `./databases:/data/sqlite` in the `volumes` of the `app` service, and make it readable for uid 10001.

The same applies to a bind-mounted storage directory (`./storage:/app/storage`): if it is owned by root the container cannot write to it, and the entrypoint fails with `Permission denied` (or the app returns 500s). Fix it on the host with `sudo chown -R 10001:10001 ./storage`. See [Using a normal folder instead](#using-a-normal-folder-instead).

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

Take a backup first. Then, with the published image:

    docker pull ghcr.io/dbzuper/dbzuper:latest
    docker rm -f dbzuper    # the volumes keep your data
    docker run -d --name dbzuper ...   # the same command as before

with Compose and the published image, `docker compose pull && docker compose up -d`; from source:

    git pull
    docker compose up -d --build

The volumes survive, the entrypoint runs `php artisan migrate --force` on start, and the key is reused. Changes that need action on your side are listed in the [changelog](../CHANGELOG.md).

## Environment reference

| Variable                        | Default                     | Meaning                                                                                                                            |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `APP_NAME`                      | `DBZuper` in the image      | Name in the page title, sidebar, session cookie and two-factor issuer.                                                             |
| `DBZUPER_SQLITE_PATHS`          | `/data/sqlite` in the image | Comma-separated directories SQLite connection files must live in.                                                                  |
| `DBZUPER_CONNECT_TIMEOUT`       | `5`                         | Seconds to wait when opening a connection to a database server.                                                                    |
| `DBZUPER_INTROSPECTION_TIMEOUT` | `30`                        | Seconds allowed for loading a schema.                                                                                              |
| `DBZUPER_QUERY_TIMEOUT`         | `15`                        | Seconds a SQL editor statement may run (not enforced on SQLite or for non-`SELECT` statements on MySQL).                           |
| `DBZUPER_SCHEMA_MAX_OBJECTS`    | `5000`                      | Most tables and views kept in a schema snapshot.                                                                                   |
| `DBZUPER_HISTORY_KEEP`          | `5000`                      | Query history entries kept per connection.                                                                                         |
| `DBZUPER_PASSWORD_POLICY`       | `strong`                    | Account passwords: `strong` (12+ characters, mixed case, number, symbol, not breached) or `basic` (8+ characters).                 |
| `MAIL_MAILER`                   | `log` (sends nothing)       | Set to `smtp` with the other `MAIL_*` variables to offer reset links by email (see [Reset links by email](#reset-links-by-email)). |
| `TRUSTED_PROXIES`               | unset                       | Reverse proxies whose `X-Forwarded-*` headers are trusted (IPs/CIDRs or `*`).                                                      |
| `APP_URL`                       | `http://localhost:<port>`   | Public URL of the app (set in `.env.docker`); the port is `DBZUPER_PORT`, else `PORT`.                                             |
| `DBZUPER_PORT`                  | `8080`                      | Host port Compose publishes, and the port in the default `APP_URL` (see [Choosing the port](#choosing-the-port)).                  |
| `PORT`                          | `8080`                      | Port the server listens on inside the container (1024 or higher); only for setups without a port mapping.                          |
| `APP_KEY`                       | generated into the volume   | Encryption key; see above.                                                                                                         |
| `SESSION_SECURE_COOKIE`         | unset                       | Set `true` when served over HTTPS.                                                                                                 |
| `DB_JOURNAL_MODE`               | `WAL` in the image          | SQLite journal mode of the application database (unset: SQLite's default).                                                         |
| `DB_TRANSACTION_MODE`           | `IMMEDIATE` in the image    | How SQLite transactions on the application database start (`DEFERRED` outside the image).                                          |
| `DB_BUSY_TIMEOUT`               | `5000`                      | Milliseconds a request waits for the SQLite lock before failing with "database is locked".                                         |

## Troubleshooting

- **Connection refused to `localhost` or `127.0.0.1`**: that is the container itself. Use `host.docker.internal`; see [Connecting to a database on the same computer](#connecting-to-a-database-on-the-same-computer). If Docker runs inside WSL and the database on Windows, see [Docker inside WSL, database on Windows](#docker-inside-wsl-database-on-windows).
- **Connection refused or timed out to `host.docker.internal`**: the database server is listening on `127.0.0.1` only, a firewall is blocking the port, or Docker runs inside WSL while the database runs on Windows. See [Connecting to a database on the same computer](#connecting-to-a-database-on-the-same-computer).
- **`Host '172.x.x.x' is not allowed to connect to this MySQL server`**: the account exists only for `localhost` (often `root@localhost`). Create an account for `'%'` or the Docker subnet; see [Connecting to a database on the same computer](#connecting-to-a-database-on-the-same-computer).
- **`SQLSTATE[HY000]: General error: 5 database is locked`** in `docker compose logs app`: the application database is SQLite and the server handles requests in parallel. Check that `DB_JOURNAL_MODE`, `DB_TRANSACTION_MODE` and `DB_BUSY_TIMEOUT` are not overridden in `.env.docker` (`docker compose exec app env | grep ^DB_`) and that the storage volume is on a local disk (SQLite locking is unreliable over network file systems). To check a deployment, sign in, copy the session cookie (`dbzuper-session`) from the browser and fire parallel requests, for example 64 schema reads, 16 at a time:

      seq 64 | xargs -P16 -I{} curl -s -o /dev/null -w '%{http_code}\n' -b 'dbzuper-session=<value>' http://localhost:8080/api/c/1/schema | sort | uniq -c

    Every response should be `200`, and `docker compose logs app | grep -c "database is locked"` should print `0`.

## Security notes

- Only the administrator can sign in and create connections, but DBZuper connects to **any host reachable from the container**, including your internal network. Do not expose it to people you would not give that reach.
- Until the administrator exists, the setup screen asks for the one-time setup code from the server log. Keep the log private until setup is done.
- Saved credentials are encrypted at rest with `APP_KEY`; anyone holding both the storage volume and the key can read them. Treat backups accordingly, and back the key up: losing it makes saved passwords unrecoverable.
- Serve it over HTTPS and keep the container port off the public network. Behind a reverse proxy, set `TRUSTED_PROXIES` (see [HTTPS behind a reverse proxy](#https-behind-a-reverse-proxy)); leave it unset when the app is reached directly, so no `X-Forwarded-*` header is trusted.
- Changing anything that reaches the connection string (driver, host, port, username, database, SSL options or PostgreSQL schema) requires re-entering the stored password. PostgreSQL host, database, username and CA path may not contain spaces, quotes or backslashes.
- Connections marked read-only are enforced by the database session (MySQL/MariaDB `READ ONLY` transactions, PostgreSQL read-only session, SQLite read-only open mode).
- SQLite files are opened only inside `DBZUPER_SQLITE_PATHS`. The SQL editor therefore refuses `ATTACH`, `DETACH`, `VACUUM INTO` and the `temp_store_directory`/`data_store_directory` pragmas on SQLite connections, which would reach other files.
- Query history stores SQL as typed (password literals in `PASSWORD`/`IDENTIFIED BY` clauses are redacted). Turn history off per connection for sensitive work.
- Accounts cannot be deleted from the UI: DBZuper has a single administrator.
- Anyone who can run commands in the container can reset the password with `dbzuper:reset-password`, two-factor authentication included. Shell access to the server is full access to DBZuper.
