# Homelab Control

Homelab Control is a private, read-first Discord control panel for Docker and
Runtipi homelabs. It is a generic product: the bot name, server name, guilds,
roles and integrations are configuration, not assumptions in the code.

This repository is intentionally conservative. The release candidate is
strongest on the combinations that are easiest to verify: Crafty plus a
Jellyfin/Seerr/Sonarr/Radarr/Prowlarr/qBittorrent media stack, and ordinary
Docker containers. Other integrations stay optional and quiet when absent.

The project started as Sai's small Acheron bot for a server nicknamed Hades;
the published product uses neutral, configurable names so it can fit another
homelab without carrying those private names into the code or UI.

## Tested reference setup

The reference deployment used for the 0.4.0b hotfix checks is Ubuntu
Server 24.04 LTS on amd64 with Docker managed by Runtipi, a Jellyfin/Seerr
media stack (including Sonarr, Radarr, Prowlarr and qBittorrent), Crafty
Controller for Minecraft, and supporting AdGuard Home, Beszel, Scrutiny,
Paperless-ngx, Syncthing and Uptime Kuma containers. This release publishes
amd64 only; an arm64 runtime has not been tested and is not advertised as
supported. The offline test suite
covers architecture-safe metadata, Docker-only discovery and API-shaped
Pterodactyl/Pelican fixtures. Other dashboards and providers are detected only
where their documented read-only path responds; they are not claimed as
equally tested. The control agent and bot are separate Alpine-based containers;
the UI reports that container identity separately from the Ubuntu host.

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
- Guarded Runtipi and supported apt-family host maintenance workflows when the
  separately reviewed host bridge is installed; the host OS is detected rather
  than assumed to be Ubuntu.
- An optional Sunday weekly-health webhook with the compact health-card layout:
  system/runtime figures, adaptive storage meters, drive/container health and
  a small row for available app, host and bot updates. It is separate from the
  detailed `/report` command.
- GitHub release checks for the bot itself. Checks are read-only and bot
  self-updates are off by default; an administrator may opt into daily hotfixes,
  daily checks, or weekly checks from `/settings`. Enabled schedules check and
  install verified releases; the weekly policy installs stable releases weekly
  and compact hotfixes daily.
- Wake-on-LAN for arbitrary trusted devices with saved favourites.
- Administrator and guest whitelists. Service controls are opt-out by default:
  detected containers are visible and controllable after administrator
  confirmation unless protected or explicitly disabled. Set `opt-in` when you
  want every container to start read-only.

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

## From Minecraft scope to a safe test and release

The Minecraft section above describes the support boundary. The workflow below
is the complete path from a fresh homelab to a tested public release:

1. **Choose the backend and identity.** Set `MINECRAFT_BACKEND` to `auto`,
   `crafty`, `pterodactyl`, `pelican`, `docker` or `none`. Configure only the
   provider that exists on the host. Set `BOT_NAME`, `SERVER_NAME`, guild IDs
   and whitelist IDs for the installation; the product does not assume the
   names “Acheron” or “Hades”.
2. **Keep credentials local.** Put Discord, control-plane, media, network and
   Minecraft credentials in private Runtipi fields, a private `config.env`, or
   a secret manager. Use read-only upstream tokens where possible. Never put a
   real token, API key, webhook URL, private key, production endpoint or real
   host address in GitHub, an issue, a screenshot or a Discord message.
3. **Start with the safe control policy.** The default is
   `SERVICE_CONTROL_MODE=opt-out`: every detected container is visible, while
   protected containers and explicit opt-outs remain read-only. Set
   `SERVICE_CONTROL_MODE=opt-in` if you prefer to approve every container
   before controls appear. The agent discovers Docker containers and
   configured providers; the bot renders only what is actually present and
   labels a requested media or network profile **Incomplete** when named
   components are missing.
4. **Verify the useful paths.** In a private test guild, exercise `/panel`,
   `/services`, `/tasks`, `/health`, `/media`, `/network`, `/minecraft`,
   `/help`, `/ping` and `/updates`. Check that guests can read status and use `/wake`, while only
   administrators can enable a service control or maintenance action. Confirm
   that absent integrations stay hidden and that failed upstream calls are
   reported as failures rather than successes.
5. **Enable only reviewed controls.** If lifecycle controls are needed, enable
   individual containers after reviewing the detected list. Control-plane
   containers remain protected. For Crafty/Pterodactyl/Pelican, test one server
   at a time and verify the returned state, resource sample and measured
   response latency after every action.
6. **Test the maintenance path separately.** The optional root-owned bridge is
   the only part allowed to update the bot/agent images. `/updates` checks the
   configured GitHub repository and checksum; an administrator confirms the
   action; the bridge backs up the current pair, stages the exact release,
   rebuilds only `agent` and `bot`, waits for Docker and application health,
   reports the measured latency, and keeps the previous pair for rollback.
   `/updates` shows the source-archive download size in adaptive units (the
   built image size is separate) and opens a
   rollback-options view with only the approved golden target, last major
   release and retained local version as quick choices. The manual selector
   still exposes verified GitHub history for exceptional recovery; every other
   older release is legacy and not recommended. When local images have been
   pruned, choosing a version fetches that exact release. It never accepts an
   arbitrary tag or an unverified download.
   Bot self-updates remain off unless an administrator chooses a mode in
   `/settings`. `hotfix` checks and installs compact letter releases such as
   `0.4.0a` daily; `daily` checks and installs stable releases and hotfixes every
   day; `weekly` checks and installs stable releases weekly while checking and
   installing hotfixes daily. The beta channel includes both stable releases and
   pre-releases, but its automatic route is locked until an administrator
   explicitly acknowledges the **beta live-patch route** in `/settings →
   Updates`. Selecting beta never silently enables unattended updates; revoking
   that acknowledgement turns the schedule off again. The scheduler records a
   pending job and reports completion after the replacement containers answer
   health checks. For a scheduled bot OTA, that completion is attached as one
   compact extra embed to the first successful slash-command response after
   restart, then consumed permanently; manual bot updates and host/Linux
   updates keep their own completion response.
   Supported apt-family host package updates and host reboots are separate,
   explicitly confirmed operations and are never triggered by a container
   update. The agent also checks the maintenance bridge protocol before it
   enables any bot release action; if an older worker still owns the shared
   directory, the release controls stay unavailable until the current bridge
   is installed, instead of sending a request the old worker cannot validate.
7. **Publish only what was tested.** Run the offline Python and Node test
   suites, review the support matrix, inspect the staged file list and perform
   a secret scan. Commit to the intended repository, create a version tag such
   as `v0.4.0` (or compact hotfix `v0.4.0a`), and let
   `.github/workflows/release.yml` create the source archive, `SHA256SUMS`,
   GitHub release and versioned `amd64` GHCR
   images. Compact letter hotfix tags such as `v0.4.0a` are supported and are
   ordered after their matching stable patch. Make the GHCR packages public
   before another host installs the Runtipi definition. arm64 is not listed as
   a supported architecture until a real arm64 runtime is tested. Do not
   advertise an untested dashboard as supported.
8. **Install and support it.** Point the Runtipi app at the exact published
   image/tag, complete the local configuration, and repeat the private-guild
   checks on that host. If a release fails health verification, use the retained
   rollback; report the provider, architecture, release and relevant redacted
   logs when opening an issue.

Testers are welcome. Please report what host architecture, integrations and
commands you tested, but never include tokens, API keys, webhook URLs, private
keys or unredacted logs.

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
   issue trackers. The default `SERVICE_CONTROL_MODE=opt-out` keeps protected
   or explicitly disabled containers read-only; use `opt-in` for a stricter
   per-container approval workflow.
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

Set `HOMELAB_CONTROL_REPOSITORY=owner/repository` to show the latest release
in `/updates`. This check is read-only. A release never installs merely because
the bot restarts; self-updates are off by default and only run after an
administrator opts into a schedule in `/settings`. The release must
contain exactly one `.tar.gz` or `.tgz` source archive with a GitHub SHA-256
digest. The update button remains disabled when that digest is absent or when
the host bridge is not configured.

Install the root-owned bridge separately because it is the only component that
needs Docker/Compose privileges:

```sh
sudo ./scripts/install-maintenance.sh
```

Then edit `/etc/homelab-control/maintenance.env` and set the repository,
Compose file, optional Compose environment file and project name. The bridge
builds and recreates only the `agent` and `bot` services, retains the previous
images, verifies both health checks, and automatically restores the previous
images if the new release is not healthy. `/updates` exposes **Rollback
options**, with the approved golden target, last major release and retained
legacy version as quick choices, plus a selector populated from GitHub's
verified release archives for exceptional recovery. Selecting a version stages a separate
administrator confirmation; the agent resolves the version to its exact tag,
archive URL and digest, and the bridge validates them again before downloading
and building. A retained local image pair remains available as a fallback.
Manual updates and rollbacks always require administrator confirmation. Release
requests carry a confirmation marker; requests without it are refused by the
bridge. Scheduled bot updates use the same checksum and health gates and are
limited to the selected opt-in mode. Reverting to much older versions is not
recommended because
configuration, APIs or stored data may no longer be compatible.

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
- `SERVICE_CONTROL_MODE=opt-out` is the default: discovered containers are
  controllable after administrator confirmation unless explicitly disabled;
  protected control-plane containers can never be enabled. Set `opt-in` for a
  strict approval-first policy.
- API keys are read-only wherever the upstream service supports that scope.
  Webhooks and tokens are validated and are never included in embeds or audit
  output.
- `DISCORD_SUPERUSER_IDS` adds identities that can manage the administrator
  and superuser lists. Runtime changes are stored in the private bot data
  volume, not in the public config or release archive.
- `HOMELAB_CONTROL_AUTO_UPDATE_MODE=off` is the safe default. Use `/settings`
  to choose daily hotfixes, daily checks, or weekly checks after reviewing the
  release channel and backup path. Enabled modes check and install verified
  releases; weekly checks install stable releases weekly and hotfixes daily.
  `HOMELAB_CONTROL_AUTO_UPDATE_HOUR` selects the local hour.
  Beta automatic updates have an additional administrator-only acknowledgement
  step for the live-patch route; without it, the scheduler remains manual even
  if an older environment setting requested a schedule.

See [`docs/SETUP.md`](docs/SETUP.md), [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md),
[`docs/MINECRAFT.md`](docs/MINECRAFT.md) and [`SECURITY.md`](SECURITY.md) for
the full onboarding and review notes.

## Development checks

From the repository root:

```sh
python3 -m unittest discover -s agent -p 'test_*.py' -v
python3 -m unittest discover -s maintenance -p 'test_*.py' -v
cd bot && CONTROL_TOKEN=0123456789abcdef0123456789abcdef \
  DISCORD_TOKEN=test-token DISCORD_CLIENT_ID=123456789012345678 \
  DISCORD_GUILD_ID=123456789012345678 DISCORD_OWNER_ID=123456789012345678 npm test
```

The tests are offline and use mocked Docker/panel responses. They do not need
Discord credentials, a live Minecraft panel or a running homelab.

## Publishing to GitHub

This section is for a maintainer publishing a new public release; it is not a
command to paste into Discord or to run on an existing homelab. The `app/`
directory is the Runtipi app definition, while the workflow is GitHub Actions
automation. A normal publication is:

1. Push the reviewed source to the intended public repository and enable the
   included CI workflow.
2. Add a release note that names only the tested support matrix. Do not imply
   that an untested dashboard or provider is supported.
3. Create a `v*` tag after the tests and secret scan pass. The workflow packages
   the source, writes `SHA256SUMS`, creates the GitHub release checked by
   `/updates`, and publishes the verified amd64 image to GHCR. arm64 remains
   out of the app manifest until runtime testing is available. Use a normal tag
   such as `v0.4.0` for stable releases; a hyphenated tag such as
   `v0.4.0-beta.1` is published as a GitHub pre-release, while compact letter
   tags such as `v0.4.0a` remain stable hotfixes.
4. Make the GHCR packages public before using the Runtipi `app/` definition on
   another host, then point that definition at the exact image tag.

In plain language: `app/` is the Runtipi install recipe; the workflow at
`.github/workflows/release.yml` is the automated publisher; `SHA256SUMS` is the
integrity manifest used to reject a tampered download; and GHCR is the registry
that serves the versioned container images. End users do not need to create a
repository or run this publication flow unless they are maintaining their own
fork.

The project code is licensed under the GNU Affero General Public License,
version 3 or any later version (`AGPL-3.0-or-later`) from the relicensing
commit onward. The historical `v0.3.18` release was published under MIT and
remains under that licence; the AGPL applies to the next release and future
versions. A public release should still include a privacy notice for Discord
IDs, configured API endpoints and any optional webhook destination. Those
values belong to the operator's private configuration, not to the repository
or release assets. See [`LICENSE`](LICENSE) for the complete licence text.

## Public-repository safety check

The tracked project contains configuration names, placeholders and offline test
fixtures only. Before every push, confirm that the change does not add a real
Discord token, control token, upstream API key, webhook URL, SSH private key,
production endpoint, host address, runtime database or log. Keep `config.env`,
`.env*`, Runtipi app-data and maintenance files outside the repository; the
example file is intentionally safe to publish. The GitHub Actions token is an
ephemeral workflow permission supplied by GitHub, not a personal token to copy
into the project.
