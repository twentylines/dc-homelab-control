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
start/stop/restart/backup actions and stdin console endpoint.

Self-signed TLS is rejected by default. The preferred fix is scoped trust:
copy Crafty’s **public** certificate (for example `commander.cert.pem`) into
the bot’s persistent `/data` directory, set
`CRAFTY_CA_CERT_FILE=/data/crafty-ca.pem`, and restart the bot. Do not copy or
mount Crafty’s private key. If the certificate’s subject-alternative names do
not include the internal service hostname, set
`CRAFTY_TLS_SERVERNAME` to a name that is present in the certificate (Crafty’s
default certificate commonly includes `localhost`) while keeping the pinned
certificate file configured. The bot then validates that certificate only;
other HTTPS integrations keep their normal system trust store.

If a trusted certificate or scoped public certificate cannot be used,
`CRAFTY_ALLOW_INSECURE_TLS=true` remains available as an explicit private
network fallback. It disables certificate verification for Crafty and should
not be enabled on an exposed or shared network. When TLS fails, `/minecraft`
now says that no action was taken and names the safe configuration path rather
than presenting a bare certificate error.

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
