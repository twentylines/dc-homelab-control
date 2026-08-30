# Homelab Control

A private, read-first Discord control panel for a Docker homelab. It discovers the services that are actually running instead of assuming a fixed stack, and keeps optional integrations invisible when they are not present.

- Live host health, storage capacity and SMART status
- Automatic Docker catalogue with CPU, RAM, process and network details
- Categorised task manager with a short live sampling window
- Media discovery for Jellyfin, Plex, Emby, Seerr/Overseerr, the *arr family and common download clients
- Optional media-stack completeness checks with explicit missing-provider names
- Network discovery for Pi-hole, AdGuard Home, Technitium DNS, Tailscale and WireGuard
- Optional network-stack completeness checks with explicit missing-provider names
- Minecraft status and guarded controls through Crafty, compatible Pterodactyl/Pelican panels, or read-only Docker discovery
- Guarded Runtipi and Ubuntu maintenance workflows when the optional host bridge is installed
- Wake-on-LAN for arbitrary trusted devices with saved favourites
- Admin and guest whitelists; service controls are opt-in by default

The Discord bot never receives the Docker socket. A small internal agent performs bounded, read-only checks and explicit allowlisted actions. The Docker socket is mounted only into that agent because Docker lifecycle operations require it; the agent drops Linux capabilities, runs read-only, refuses protected control-plane containers, and records mutations.

The app is designed for a custom Runtipi app or a community app store. Set only the integrations you use; discovery handles the rest. Crafty and the Jellyfin + Seerr/Sonarr/Radarr/Prowlarr/qBittorrent shape are the best-tested path; unsupported or absent dashboards stay out of the UI.
