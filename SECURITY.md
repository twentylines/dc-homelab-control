# Security model

Homelab Control is intended for a private Discord server and a private Docker
network. Keep the Discord application restricted to the configured guilds and
whitelists, and keep the Runtipi app unexposed unless there is a deliberate
reverse-proxy and authentication plan.

The bot has no Docker socket. The agent has the socket because Docker lifecycle
actions require it, but it accepts only dedicated HTTP routes, validates
identifiers, refuses control-plane containers, records mutations, drops Linux
capabilities, uses a read-only root filesystem, and has bounded request
sizes/timeouts. Service controls are opt-in by default: an administrator must
enable a container before lifecycle buttons appear.

Integration credentials are optional and should be read-only tokens wherever
the upstream application supports them. Do not paste a Discord webhook, bot
token, Docker socket path, or API token into an issue or public chat. Weekly
webhook URLs are accepted only over HTTPS from `discord.com` and are never
returned by the controller API.

The controller is not a replacement for Docker hardening, host patching,
backups, network segmentation, or a security review. Treat the Docker socket as
a high-trust boundary and keep the agent reachable only on the internal app
network.
