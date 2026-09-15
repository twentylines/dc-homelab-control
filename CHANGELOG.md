# Changelog

## 0.4.1 - 2026-09-16

1. Made the GitHub release source tolerant of either `owner/repository` or an
   HTTPS GitHub URL, while continuing to reject non-GitHub hosts, credentials,
   query strings and fragments.
2. Added scoped Crafty certificate trust for self-signed installations so the
   Minecraft integration can keep TLS verification enabled without weakening
   unrelated requests; private keys are rejected by the configuration guard.
3. Kept bot self-updates manual by default and retained the archive, checksum,
   exact-repository and post-update health checks for every release action.

## 0.4.0d - 2026-09-15

1. Fixed recovery and reset-related container recreation so it always pins and
   verifies the exact image pair that was running before the action; a stale
   generated Compose file can no longer silently downgrade the control bot.
2. Kept the maintenance bridge, host operating-system and resolver mounts in
   guarded Compose overrides for older Runtipi-generated definitions.
3. Standardised the default bridge directory and added regression coverage for
   image-pair preservation and compatibility mounts.

## 0.4.0c - 2026-08-31

1. Fixed network-page titles on older Runtipi layouts by using the Docker
   engine host name instead of a container ID when the host-name bind is
   missing.
2. Fixed false “DNS not configured” results by checking Docker’s local
   resolver when a regenerated Compose file omits the host resolver bind.
3. Added regression coverage for both compatibility fallbacks without
   changing the guarded OTA validation or container-only deployment scope.

## 0.4.0b - 2026-08-31

1. Hardened release and rollback validation, including health-checked
   restoration when a control-container change does not converge.
2. Fixed retained-image rollback Compose generation and refused incomplete
   release targets before any control container can change.
3. Corrected running-version detection and kept host operating-system data
   separate from the control-container operating system.
4. Added a maintenance-bridge protocol check so incompatible legacy workers
   cannot accept current release requests.
5. Removed duplicate Discord component identifiers and stopped `/tasks` from
   starting an unsolicited five-second live-refresh loop.
6. Added release-time metadata, regression-test and Compose validation so a
   broken or stale OTA is blocked before publication.

## 0.4.0a - 2026-08-31

1. Fixed host operating-system detection when the direct host bind is missing;
   the host identity can now be recovered through the mounted host process
   root without confusing it with the control-container image.
2. Narrowed rollback quick actions to the approved golden target and last major
   release, while retaining the local legacy image fallback. Other verified
   GitHub history remains available through the clearly labelled legacy
   selector and is marked as not recommended for routine use.
3. Added direct **Back to home** navigation beside parent-route buttons across
   deep detail, confirmation, result and error views, and clarified automatic
   update policies as check-and-install schedules.
4. Completed compact letter hotfix handling for `a` through `z`, including
   case-insensitive parsing, ordering and explicit `0.4.0a` coverage. The
   `0.4.0a` tag is published as a stable-channel hotfix.

## 0.4.0 - 2026-08-31

1. Added a persisted `/settings` area for access identities, release streams,
   opt-in self-update schedules, control policy and recovery actions. Runtime
   state is kept separate from secrets; destructive resets create a private
   backup before clearing the configured settings files.
2. Added multiple superuser support with owner protection, runtime admin/guest
   management and read-only guest boundaries for non-administrators.
3. Added scheduled bot updates that are disabled by default, with daily,
   weekly-stable and daily-hotfix modes, a local-hour setting, duplicate-job
   protection and a post-restart completion notice only after both control
   health checks pass; scheduled OTA completion is attached once to the first
   successful slash-command response after restart, while manual workflows
   retain their own completion response.
4. Extended release discovery to stable and beta streams, public rollback
   policy metadata, adaptive archive sizes and compact letter hotfix ordering;
   hyphenated beta/RC identifiers are compared semantically; every downloaded
   archive remains repository-, URL-, checksum- and health-verified by the
   root bridge.
5. Added read-only internal gateway and DNS connectivity measurements and a
   `/ping` view that reports bot, gateway and DNS timing without exposing
   private addresses.
6. Improved host identity reporting so the detected host operating system and
   the control-container operating system are labelled separately; unsupported
   host package managers remain explicitly unavailable.
7. Added safe settings reset/restore, preserve-config repair and explicitly
   confirmed fresh repair flows with private timestamped backups and health
   verification.
8. Removed the public `/controls` command in favour of the clearer settings
   path, kept legacy component handling compatible, and refreshed help,
   navigation and update-source fallbacks for deployments without Runtipi.
9. Documented the tested Ubuntu/Runtipi amd64 reference stack, neutral branding,
   provider boundaries, AGPL distribution obligations and the decision not to
   advertise arm64 until a real arm64 runtime is tested.
10. Added release-policy fixtures, scheduler coverage hooks and regression
    checks for the new settings, release, network and security boundaries.
11. Restored the compact weekly health card with consistent adaptive storage
    bars and a quiet summary of available host, Runtipi and bot updates.
12. Added an explicit beta live-patch acknowledgement gate for automatic bot
    updates; selecting the beta stream alone can never enable unattended
    updates, while beta users still receive stable releases.

## 0.3.22c - 2026-08-31

1. Added verified multi-version rollback history with recommended release lines
   and exact prior-version selection from the configured GitHub repository.
2. Added adaptive source-archive sizes to update and rollback views, while
   keeping the existing SHA-256 and health-check gates intact.
3. Fixed the host maintenance fallback label so an unavailable host identity
   cannot render as the duplicated “Host host”; host and control-container
   operating systems remain separate.
4. Made explicit older-version selections bypass retained-image shortcuts so
   the requested GitHub release is the one that is downloaded and verified.

## 0.3.22b - 2026-08-31

1. Published the complete numbered changelog in the GitHub release metadata so
   the administrator confirmation panel shows the actual changes, not only a
   compare URL.
2. Added compact `b` hotfix release support to the read-only release check and
   the manually confirmed update bridge.

## 0.3.22 - 2026-08-31

1. Separated host-maintenance and bot-release status feeds so a control
   container restart cannot masquerade as a host restart or change its OS.
2. Added explicit host and control-container OS identities; the host label now
   comes only from the mounted host `/etc/os-release` file.
3. Added stale-status recovery for installations upgraded from the affected
   status layout.
4. Made bot release handling explicitly manual-only: release checks are
   read-only, and the bridge refuses requests without administrator confirmation.

## 0.3.21 - 2026-08-31

1. Added a restart-safe bot update hand-off that keeps the original Discord
   response alive while the control containers replace themselves.
2. Added post-restart verification and a verified completion response, with a
   webhook fallback when Discord's interaction window has expired.
3. Added the selected GitHub release notes to the administrator confirmation
   panel with bounded, mention-safe rendering.
4. Hardened audit storage permissions and removed unnecessary identifiers from
   routine logs.

## 0.3.20 - 2026-08-31

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
