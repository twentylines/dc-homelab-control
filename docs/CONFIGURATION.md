# Configuration reference

`config.example.env` is the complete local-compose template. Copy it to
`config.env` and keep the copy private. Values entered as container environment
variables take precedence over the optional config file; blank form fields can
still be filled from that file.

| Setting | Required | Purpose |
| --- | --- | --- |
| `CONTROL_TOKEN` | Yes | Agent/bot shared secret; 32+ random characters. |
| `DISCORD_TOKEN` | Yes | Bot token. |
| `DISCORD_CLIENT_ID` | Yes | Discord application ID. |
| `DISCORD_GUILD_ID` | Yes | Primary guild for command registration. |
| `DISCORD_OWNER_ID` | Yes | First administrator identity. |
| `DISCORD_SUPERUSER_IDS` | No | Additional identities allowed to manage access settings. |
| `DISCORD_GUILD_IDS` | No | Additional allowed guild IDs. |
| `DISCORD_ADMIN_USER_IDS` / `DISCORD_ADMIN_ROLE_IDS` | No | Extra administrators. |
| `DISCORD_GUEST_USER_IDS` / `DISCORD_GUEST_ROLE_IDS` | No | Read-only users; `/wake` remains available. |
| `BOT_NAME` / `SERVER_NAME` / `TIME_ZONE` | No | Branding and timestamps. |
| `SERVICE_CONTROL_MODE` | No | `opt-out` (default), or `opt-in` for approval-before-controls. |
| `HOMELAB_CONTROL_REPOSITORY` | No | Public GitHub `owner/repository` used for read-only bot release checks. |
| `HOMELAB_CONTROL_VERSION` | No | Installed bot release, used for safe version comparison. |
| `HOMELAB_CONTROL_RELEASE_CHANNEL` | No | `stable` (default) or `beta`; beta includes stable releases and GitHub pre-releases. Automatic beta updates still require an explicit administrator acknowledgement in `/settings`. |
| `HOMELAB_CONTROL_RELEASE_ASSET` | No | Exact archive filename when a release contains more than one archive. |
| `HOMELAB_CONTROL_RELEASE_POLICY_URL` | No | Optional HTTPS raw GitHub URL for approved golden/LTS/previous-line rollback metadata. |
| `HOMELAB_CONTROL_AUTO_UPDATE_MODE` | No | `off` (default), `hotfix`, `daily` or `weekly`; schedules are opt-in from `/settings`, and beta schedules are additionally locked behind the live-patch acknowledgement. |
| `HOMELAB_CONTROL_AUTO_UPDATE_HOUR` | No | Local hour (0–23, default 4) used by an enabled schedule. |
| `MEDIA_REQUIRED_PROVIDERS` | No | Explicit media contract, e.g. `jellyfin,seerr,sonarr`. |
| `MEDIA_STACK_PROFILE` | No | `auto`, `full`, `minimal`, or `none`. |
| `NETWORK_REQUIRED_PROVIDERS` | No | Explicit DNS/network contract. |
| `JELLYFIN_*` / `PLEX_*` | No | Read-only media APIs. |
| `PIHOLE_BASE_URL` / `TECHNITIUM_BASE_URL` / `ADGUARD_BASE_URL` | No | External read-only network endpoints. |
| `MINECRAFT_BACKEND` | No | `auto`, `docker`, `crafty`, `pterodactyl`, `pelican`, or `none`. |
| `CRAFTY_*` | No | Crafty URL, token and optional self-signed TLS switch. |
| `PTERODACTYL_*` / `PELICAN_*` | No | API-compatible client panel URL and token. |
| `WAKE_*` | No | Default Wake-on-LAN favourite/broadcast. |
| `WEEKLY_REPORT_*` | No | Optional HTTPS Discord webhook and weekly toggle. |

## File format rules

The loader accepts one `KEY=VALUE` per line, ignores blank lines and comments,
and strips matching single or double quotes. It does not evaluate command
substitutions, backticks, redirects or other shell syntax. Values are bounded
or validated by the application before use.

## Resource paths

For local Compose, `APP_DATA_DIR` stores the bot and agent state,
`HOST_DATA_PATH` is the read-only application-data view, `MEDIA_PATH` is the
read-only media view, and `MAINTENANCE_DIR` is the only writable host bridge
directory. The bot runtime settings overlay is `${APP_DATA_DIR}/bot/settings.json`;
set `HOMELAB_CONTROL_SETTINGS_FILE` to that host-side path in the root bridge
configuration when you want reset/restore to include it. Change these paths
before the first start when the defaults do not match the host. Keep the
optional bot config path separate from `HOMELAB_CONTROL_ENV_FILE` when
possible: a settings reset clears the configured config file after backing it
up, while the Compose environment file supplies the credentials needed to
recreate the containers.

The root bridge reads its own `/etc/homelab-control/maintenance.env`. Its
`HOMELAB_CONTROL_MAINTENANCE_DIR` must match `MAINTENANCE_DIR`, and its
`HOMELAB_CONTROL_COMPOSE_FILE`, `HOMELAB_CONTROL_ENV_FILE` and optional
`HOMELAB_CONTROL_COMPOSE_PROJECT` identify the existing control deployment.
The bridge keeps release images under `HOMELAB_CONTROL_RELEASE_ROOT` and never
uses a shell-evaluated update command.

For `/updates` bot rollback, the agent first reports a retained local image
pair when one exists. It also checks the configured public GitHub repository
for up to 25 earlier stable releases with exactly one source archive and a
GitHub SHA-256 digest. The administrator sees adaptive source-archive download
sizes in the rollback-options view and can choose a recommended release line
or an exact version from the selector. The root bridge re-validates the
repository, tag,
download path, archive layout and digest before rebuilding only the control
agent and bot. The public `release-policy.json` file can mark golden, LTS and
previous-major-line versions; it is advisory metadata only and the exact
release archive and digest are still checked by the bridge. A release policy
does not enable self-updates.

## Secret handling

Use read-only upstream tokens where available. Do not place tokens in a public
repository, Discord message, issue, screenshot or log. The bot does not echo
tokens, webhook URLs or raw Docker inspect payloads. Rotate a token if it has
been exposed.
