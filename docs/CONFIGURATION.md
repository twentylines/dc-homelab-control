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
| `DISCORD_GUILD_IDS` | No | Additional allowed guild IDs. |
| `DISCORD_ADMIN_USER_IDS` / `DISCORD_ADMIN_ROLE_IDS` | No | Extra administrators. |
| `DISCORD_GUEST_USER_IDS` / `DISCORD_GUEST_ROLE_IDS` | No | Read-only users; `/wake` remains available. |
| `BOT_NAME` / `SERVER_NAME` / `TIME_ZONE` | No | Branding and timestamps. |
| `SERVICE_CONTROL_MODE` | No | `opt-out` (default), or `opt-in` for approval-before-controls. |
| `HOMELAB_CONTROL_REPOSITORY` | No | Public GitHub `owner/repository` used for bot update and rollback checks. |
| `HOMELAB_CONTROL_VERSION` | No | Installed bot release, used for safe version comparison. |
| `HOMELAB_CONTROL_RELEASE_CHANNEL` | No | `stable` only in this release; pre-releases are ignored. |
| `HOMELAB_CONTROL_RELEASE_ASSET` | No | Exact archive filename when a release contains more than one archive. |
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
directory. Change these paths before the first start when the defaults do not
match the host.

The root bridge reads its own `/etc/homelab-control/maintenance.env`. Its
`HOMELAB_CONTROL_MAINTENANCE_DIR` must match `MAINTENANCE_DIR`, and its
`HOMELAB_CONTROL_COMPOSE_FILE`, `HOMELAB_CONTROL_ENV_FILE` and optional
`HOMELAB_CONTROL_COMPOSE_PROJECT` identify the existing control deployment.
The bridge keeps release images under `HOMELAB_CONTROL_RELEASE_ROOT` and never
uses a shell-evaluated update command.

For `/updates` bot rollback, the agent first reports a retained local image
pair when one exists. If it does not, it checks the configured public GitHub
repository for the highest earlier stable semantic version with exactly one
source archive and a GitHub SHA-256 digest. The administrator sees that version
on the version rollback button; the root bridge re-validates the repository, tag,
download path, archive layout and digest before rebuilding only the control
agent and bot.

## Secret handling

Use read-only upstream tokens where available. Do not place tokens in a public
repository, Discord message, issue, screenshot or log. The bot does not echo
tokens, webhook URLs or raw Docker inspect payloads. Rotate a token if it has
been exposed.
