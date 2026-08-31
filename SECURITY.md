# Security model

Homelab Control is intended for a private Discord server and a private Docker
network. Keep the Discord application restricted to the configured guilds and
whitelists, and keep the Runtipi app unexposed unless there is a deliberate
reverse-proxy and authentication plan.

The project code is licensed under `AGPL-3.0-or-later`. Modified versions that
are offered as a network service must provide remote users a way to obtain the
corresponding source, as described by the licence. Keep the source link and
version information available in any public deployment.

The bot has no Docker socket. The agent has the socket because Docker lifecycle
actions require it, but it accepts only dedicated HTTP routes, validates
identifiers, refuses control-plane containers, records mutations, drops Linux
capabilities, uses a read-only root filesystem, and has bounded request
sizes/timeouts. Service controls are opt-out by default: protected containers
and explicit opt-outs remain read-only, while every mutating action still
requires an administrator confirmation. Set `SERVICE_CONTROL_MODE=opt-in` for
approval-before-controls.

Integration credentials are optional and should be read-only tokens wherever
the upstream application supports them. Do not paste a Discord webhook, bot
token, Docker socket path, or API token into an issue or public chat. Weekly
webhook URLs are accepted only over HTTPS from `discord.com` and are never
returned by the controller API.

## Public repository and release safety

The public source may contain setting names, safe placeholders and mocked test
values. It must never contain a real Discord token, control token, upstream API
key, webhook URL, SSH private key, production endpoint, host address, runtime
database or log. Keep `config.env`, `.env*`, Runtipi app-data and maintenance
files private; `config.example.env` is the publishable template. Review the
tracked file list and run a secret scan before every push. The GitHub Actions
workflow receives its short-lived `${{ github.token }}` permission at runtime;
no personal GitHub token belongs in the repository.

The controller is not a replacement for Docker hardening, host patching,
backups, network segmentation, or a security review. Treat the Docker socket as
a high-trust boundary and keep the agent reachable only on the internal app
network.
