# Setup guide

This guide covers a local Docker Compose install. It is the easiest way to
test the product before packaging it for Runtipi.

## 1. Create the Discord application

In the Discord Developer Portal, create an application and add a bot user.
Copy the bot token, application ID, one server (guild) ID, and your own user
ID. Enable the `applications.commands` scope when generating the install URL.
The bot needs only the permissions required for slash commands and messages in
the channel where you want it to respond; do not grant Administrator.

The bot registers commands only in the guild IDs you configure. It does not
join arbitrary servers or read message history.

## 2. Prepare the host

Install Docker Engine/Desktop and the Compose plugin. The host must be able to
read its own `/proc` and `/sys` trees and the Docker socket. The compose file
does not publish the agent or bot ports to the LAN; they communicate on a
private bridge network.

```sh
git clone <your-public-repository-url> homelab-control
cd homelab-control
./scripts/install-compose.sh
```

The first run creates `config.env` and exits. Open it in a local editor and
replace the five required values. Generate `CONTROL_TOKEN` with a password
manager or a cryptographically secure random generator; it must be at least 32
characters. The default `SERVICE_CONTROL_MODE=opt-out` exposes detected
containers to administrators after confirmation while protected or explicitly
disabled containers remain read-only. Set `SERVICE_CONTROL_MODE=opt-in` if you
want to approve every container before its controls appear.

## 3. Add only the integrations you use

Leave optional URLs and tokens blank if the service is not installed. For a
Jellyfin stack, a read-only API key enables sessions, recent additions, library
counts and alerts. For Minecraft, configure exactly one of:

- Crafty: `CRAFTY_BASE_URL` and a restricted `CRAFTY_API_TOKEN`;
- Pterodactyl: `PTERODACTYL_BASE_URL` and a client API token;
- Pelican: `PELICAN_BASE_URL` and a client API token;
- Docker-only discovery: leave panel values blank and keep
  `MINECRAFT_BACKEND=auto` or set it to `docker`.

For a single-file configuration, the bot reads `HOMELAB_CONTROL_CONFIG_FILE`
as simple `KEY=VALUE` lines. Non-empty environment variables supplied by
Compose win; blank form fields can still be filled from the file. It is not
sourced as a shell script. Never commit `config.env`.

## 3a. Optional bot self-updates

To make `/updates` check the bot itself, set
`HOMELAB_CONTROL_REPOSITORY=owner/repository` and keep
`HOMELAB_CONTROL_VERSION` at the installed release. The repository's tagged
release must be produced by `.github/workflows/release.yml`, which publishes a
single source archive and its SHA-256 checksum.

The update and rollback buttons require the separate root bridge. Install it
once with `sudo ./scripts/install-maintenance.sh`, then edit
`/etc/homelab-control/maintenance.env`:

```text
HOMELAB_CONTROL_MAINTENANCE_DIR=/var/lib/homelab-control/maintenance
HOMELAB_CONTROL_REPOSITORY=owner/repository
HOMELAB_CONTROL_COMPOSE_FILE=/srv/homelab-control/compose.local.yml
HOMELAB_CONTROL_ENV_FILE=/srv/homelab-control/config.env
HOMELAB_CONTROL_COMPOSE_PROJECT=homelab-control
HOMELAB_CONTROL_RELEASE_ROOT=/var/lib/homelab-control/maintenance/releases
```

For Runtipi, point `HOMELAB_CONTROL_COMPOSE_FILE` at the app's generated
Compose file, `HOMELAB_CONTROL_ENV_FILE` at the app environment file, and set
the project name used by `docker compose`. The maintenance directory in this
file must be the same host directory mounted read-write at `/host/maintenance`
in the agent. The bridge validates the repository and exact GitHub asset URL,
verifies the digest, checks the archive contents, rebuilds only `agent` and
`bot`, waits for both health checks, and keeps the prior images for rollback. If
those images have been pruned, `/updates` supplies the highest earlier stable
release with a verified GitHub archive; the bridge validates that metadata
again before it downloads anything. It never updates other containers and
never restarts the host.

## 4. Validate, then start

```sh
./scripts/install-compose.sh --check
./scripts/install-compose.sh
docker compose --env-file config.env -f compose.local.yml ps
```

The check command does not build or start anything. The normal command builds
the agent and bot locally and starts them with a restart policy. Use the
following when diagnosing a first launch:

```sh
docker compose --env-file config.env -f compose.local.yml logs --tail=100 agent bot
```

Once the bot is online, run `/panel` in the configured guild. Review `/services`
and `/controls` before enabling any lifecycle controls. The first `/tasks`
sample can take a few seconds because Docker stats are collected on demand.

## 5. Runtipi packaging

For a custom Runtipi app, stage the `app/` directory and fill the form fields.
The generated compose file is deliberately unexposed and keeps the Docker
socket on the agent only. Optional provider fields may stay blank. For less
clutter, place advanced `KEY=VALUE` settings in the bot app-data directory and
set `HOMELAB_CONTROL_CONFIG_FILE=/data/config.env`.

Do not submit the app to a public store until the GHCR packages are public and
the image references point to the exact published version.
