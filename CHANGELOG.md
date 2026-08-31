# Changelog

## Unreleased (next release)

1. Added verified GitHub rollback discovery: `/updates` now finds the highest
   earlier stable release when retained local control images are unavailable.
2. Kept rollback guarded end to end: the agent selects the exact repository,
   tag, archive and SHA-256 digest, while the root bridge validates them again,
   rejects unsafe archives, rebuilds only the control agent and bot, and checks
   both services before declaring success.
3. Added automatic recovery to the running control release when a local or
   fetched rollback fails health verification.
4. Added detected host-OS labels to status, reports and maintenance flows;
   apt-family host updates are supported only where the bridge explicitly
   recognises the operating system.
5. Improved command navigation, measured response timing and honest progress
   feedback across interactive views.
6. Expanded the onboarding, security, publishing and tested-setup
   documentation, with Python and Node regression coverage for the new paths.

## 0.3.19 - 2026-08-31

- relicensed the project code under GNU AGPLv3-or-later; the historical
  `v0.3.18` release remains MIT-licensed and is not retroactively changed;
- added public-source and remote-network licence guidance to the security and
  publishing documentation.

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
