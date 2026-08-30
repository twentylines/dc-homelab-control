# Changelog

## 0.3.18 - 2026-08-30

- added a GitHub stable-release check to `/updates` with an honest unavailable
  state when no repository or release digest is configured;
- added administrator-confirmed, checksum-gated bot update and rollback
  controls backed by the root-owned maintenance bridge;
- added an archive-safe Compose rebuild workflow that changes only the control
  agent and bot, verifies both health checks, and restores the previous images
  automatically after a failed verification;
- added a tagged-release workflow that publishes the source archive and
  `SHA256SUMS` for the release check.

## 0.2.0 - release candidate

- renamed the product to the neutral Homelab Control;
- added Runtipi onboarding fields for branding, whitelists and integrations;
- discovered Docker containers and common media/network providers without a
  fixed app allowlist;
- added explicit complete/incomplete media and optional network-stack reports;
- kept absent optional services out of the UI;
- added opt-in container-control policy and protected control-plane defaults;
- added generic Runtipi paths, `amd64`/`arm64` metadata and a no-expose default;
- added security, onboarding and publishing documentation.
- added provider-aware Minecraft discovery with Crafty, Pterodactyl and Pelican
  adapters plus a read-only Docker fallback;
- added per-server resource summaries and a dedicated Minecraft task category;
- added a local Compose installer, single-file configuration template, setup
  guides, contribution notes and offline CI validation.
