# Homelab Control

Homelab Control is a private, read-first Discord control panel for Docker and
Runtipi homelabs. It is a generic product: the bot name, server name, guilds,
roles and integrations are configuration, not assumptions in the code.

This repository is intentionally conservative. The release candidate is
strongest on the combinations that are easiest to verify: Crafty plus a
Jellyfin/Seerr/Sonarr/Radarr/Prowlarr/qBittorrent media stack, and ordinary
Docker containers. Other integrations stay optional and quiet when absent.

## What is included

- Live host health, capacity, SMART results and useful host specifications.
- Automatic Docker discovery on every refresh; renamed/replaced containers are
  shown without editing a hard-coded list.
- A categorised task manager with host totals, per-container CPU/RAM/PIDs and
  network counters, plus a short five-second live sampling window.
- Media discovery for Jellyfin, Plex, Emby, Tautulli, Audiobookshelf, Kavita,
  Komga, Navidrome, Immich, Seerr/Overseerr, the *arr family and common
  download clients.
- Optional Jellyfin read-only sessions, recent additions, library counts and
  alerts. Plex health/activity is available when a read-only token is supplied.
- Optional media and network completeness contracts that name the components
  genuinely missing from a configured profile.
- Network discovery for Pi-hole, AdGuard Home, Technitium DNS, Unbound, CoreDNS,
  Tailscale and WireGuard.
- Minecraft discovery/control through Crafty, API-compatible Pterodactyl or
  Pelican client panels, and a read-only Docker fallback for recognisable
  Minecraft images (Paper, Purpur, Fabric, Forge, Bedrock and similar).
- Guarded Runtipi and Ubuntu maintenance workflows when the separately reviewed
  host bridge is installed.
- GitHub release checks for the bot itself, with checksum-gated update and
  rollback controls through the root-owned host bridge.
- Wake-on-LAN for arbitrary trusted devices with saved favourites.
- Administrator and guest whitelists. Service controls are opt-in by default.

Absent software is not rendered as an error. A detected provider gets an
actual container or endpoint check; an internal-only running container is
reported as process-alive rather than falsely called unreachable.

## Minecraft scope (deliberately narrow)

Crafty is the best-tested Minecraft panel and provides the richest server
controls. Pterodactyl and Pelican are supported only through their compatible
client API endpoints; status, resources and standard power/backup actions are
shown when that API answers. A direct Docker Minecraft container is detected
and its real resource usage is displayed, but it remains read-only until an
appropriate panel is configured. AMP and vendor-specific consoles are not
claimed as supported in this release. This limitation is deliberate: a small,
well-tested surface is safer to publish than a long list of speculative
adapters.

## Quick start with Docker Compose

1. Install Docker Engine/Desktop with the Compose plugin.
2. Copy this directory to the host that will run the bot:

   ```sh
   git clone <your-public-repository-url> homelab-control
   cd homelab-control
   ```

3. Run `./scripts/install-compose.sh` once. It creates a private
   `config.env` from [`config.example.env`](config.example.env) and stops so
   you can fill in the required Discord values.
4. Edit `config.env` with a text editor. Do not paste real tokens into Git or
   issue trackers. Keep `SERVICE_CONTROL_MODE=opt-in` until you have reviewed
   the detected containers.
5. Run `./scripts/install-compose.sh --check` to validate the values and
   Compose definition without starting anything.
6. Run `./scripts/install-compose.sh` again. It builds the two images locally
   and starts the agent and bot. The bot registers its commands in the listed
   Discord guilds.
7. Use `/panel`, `/services`, `/tasks`, `/media`, `/network` and `/minecraft`
   in the configured guild. Guests can use only the read-only commands and
   `/wake`; administrators must confirm mutating actions.

The local compose file mounts the Docker socket only into the bounded agent.
The Discord bot never receives it. Host paths default to folders below this
checkout; set `HOST_DATA_PATH`, `MEDIA_PATH` and `MAINTENANCE_DIR` explicitly
when your data lives elsewhere.

## Runtipi

The `app/` directory is a custom-app payload. In Runtipi, import or stage the
app, complete the Discord identity and whitelist fields, then leave optional
providers blank unless they exist. For advanced integrations, create a private
`config.env` in the bot app-data directory using the same `KEY=VALUE` format as
the example and set `HOMELAB_CONTROL_CONFIG_FILE` to `/data/config.env`.
Non-empty environment values entered by Runtipi take precedence; blank form
fields can still be filled from that file. The loader never evaluates it as
shell code.

The Runtipi definition points at the versioned GHCR images published by this
repository's release workflow. Make those packages public before installing
the app on another host, and run [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)
before submitting it to a community or own Runtipi store.

## Bot releases and rollback

Set `HOMELAB_CONTROL_REPOSITORY=owner/repository` to show the latest stable
GitHub release in `/updates`. The release must contain exactly one `.tar.gz` or
`.tgz` source archive with a GitHub SHA-256 digest. The update button remains
disabled when that digest is absent or when the host bridge is not configured.

Install the root-owned bridge separately because it is the only component that
needs Docker/Compose privileges:

```sh
sudo ./scripts/install-maintenance.sh
```

Then edit `/etc/homelab-control/maintenance.env` and set the repository,
Compose file, optional Compose environment file and project name. The bridge
builds and recreates only the `agent` and `bot` services, retains the previous
images, verifies both health checks, and automatically restores the previous
images if the new release is not healthy. `/updates` exposes **Revert bot**
while a previous verified image pair is retained. No update is automatic: an
administrator must confirm it.

The worker rejects non-GitHub URLs, path traversal, symlinks, unexpected
archive contents, checksum mismatches and releases from a different configured
repository. Keep the maintenance directory writable by the agent container but
root-owned files and the bridge configuration private.

## Configuration highlights

- `MEDIA_REQUIRED_PROVIDERS` or `MEDIA_STACK_PROFILE` controls whether an
  installation is labelled Complete/Incomplete. Blank requirements mean
  discovery only.
- `NETWORK_REQUIRED_PROVIDERS` is opt-in for the same reason: homelabs use
  different DNS/VPN designs.
- `MINECRAFT_BACKEND=auto` prefers a configured Crafty, Pterodactyl or Pelican
  API and otherwise uses Docker discovery. Set `docker` for read-only Docker
  mode or `none` to hide Minecraft entirely.
- `SERVICE_CONTROL_MODE=opt-in` keeps discovered containers read-only until an
  administrator enables a specific control policy. Protected control-plane
  containers cannot be enabled.
- API keys are read-only wherever the upstream service supports that scope.
  Webhooks and tokens are validated and are never included in embeds or audit
  output.

See [`docs/SETUP.md`](docs/SETUP.md), [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md),
[`docs/MINECRAFT.md`](docs/MINECRAFT.md) and [`SECURITY.md`](SECURITY.md) for
the full onboarding and review notes.

## Development checks

From the repository root:

```sh
python3 -m unittest discover -s agent -p 'test_*.py' -v
cd bot && CONTROL_TOKEN=0123456789abcdef0123456789abcdef \
  DISCORD_TOKEN=test-token DISCORD_CLIENT_ID=123456789012345678 \
  DISCORD_GUILD_ID=123456789012345678 DISCORD_OWNER_ID=123456789012345678 npm test
```

The tests are offline and use mocked Docker/panel responses. They do not need
Discord credentials, a live Minecraft panel or a running homelab.

## Publishing to GitHub

Create an empty public repository and copy this directory into it. Add a short
release note describing the tested support matrix; do not imply that an
untested dashboard is supported. Push the repository and enable the included
CI workflow before submitting the `app/` payload to a Runtipi app store.

The included `.github/workflows/release.yml` packages each `v*` tag as a source
archive, publishes `SHA256SUMS`, creates the GitHub release that the bot
checks, and publishes versioned `amd64`/`arm64` images to GHCR. Make the GHCR
packages public before using the Runtipi app definition on another host.

The project is MIT licensed. A public release should still include a privacy
notice for Discord IDs, API endpoints and any optional webhook destination.
