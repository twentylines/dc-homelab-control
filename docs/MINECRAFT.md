# Minecraft integrations

Minecraft support is intentionally limited to integrations that can be kept
read-first and tested offline. The `/minecraft` view discovers configured
panels, lists servers, and shows per-server CPU, RAM and process counts where
the upstream API returns them. Selecting a server opens the detailed resource
view; mutating buttons are visible only to administrators and require a
confirmation.

## Supported modes

### Crafty Controller

Crafty is the best-tested panel in this release. Set `CRAFTY_BASE_URL` and a
restricted `CRAFTY_API_TOKEN`. The bot uses the v2 server list, stats, standard
start/stop/restart/backup actions and stdin console endpoint. Self-signed TLS
is rejected by default; set `CRAFTY_ALLOW_INSECURE_TLS=true` only on a trusted
private network when the panel cannot provide a valid certificate.

### Pterodactyl and Pelican

Set the relevant base URL and client token, and choose the backend explicitly or
leave `MINECRAFT_BACKEND=auto`. The adapter uses the common client endpoints
for server listing, resource sampling, power signals, backups and console
commands. If a panel version changes those endpoints, the bot reports the
actual HTTP error instead of pretending that the action completed. A token is
never displayed in Discord.

### Docker fallback

With no panel configured, the agent detects recognisable Minecraft containers
by bounded image/name patterns (Paper, Purpur, Fabric, Forge, Folia, Velocity,
Bedrock, Spigot and common images). It reports live state and Docker resource
usage. Docker-only mode is read-only: use a supported panel for safe lifecycle
controls and console access.

## Deliberate limitations

AMP and vendor-specific dashboards are not advertised as supported yet. A
generic container whose name/image gives no reliable Minecraft signal may not
be detected; this avoids misclassifying unrelated services such as Paperless.
The release is therefore best suited to Crafty plus the existing Jellyfin media
stack shape, while still being useful for other Docker homelabs. Expand the
adapter only after adding mocked API fixtures and an end-to-end review.
