# Migrating to 0.5.0

The Discord bot now runs Python 3.12 and discord.py. The host agent and host
maintenance bridge keep the v0.4 API and release-job format.

## Existing installations

1. Open `/updates`, refresh the GitHub check and review the 0.5.0 release notes.
2. Confirm Update bot. The host bridge verifies the exact archive digest,
   builds the new agent and bot, and recreates only those two services.
3. Wait for Discord to reconnect and the completion message to update. If the
   original interaction expires, open `/updates` to see the bridge's result.
4. Open a fresh `/panel`. Old v0.4 navigation buttons still open their page;
   other old controls ask you to reopen the panel.

The data volume, `config.env`, environment settings, access deny-lists, wake
favourites and pending interaction files retain their existing formats. The
bot keeps UID/GID 1000. Stable manual-update policy remains manual. A confirmed
Beta route requires daily automatic updates and receives both beta and stable
releases; choose Stable to leave that route.

The installed v0.4 host bridge requires `bot/package.json` and
`bot/package-lock.json` when validating an archive. Those two files are empty
dependency markers, not a Node application. They remain solely so the existing
bridge can accept the Python release without a manual bridge upgrade.

Existing generated Compose files probe the bot with `node -e` and one fixed
HTTP healthcheck. The Python image includes a small executable named `node`
that accepts **only that exact probe**. It cannot execute JavaScript. The probe
stays in the shared Compose payload so retained older Node images can also
pass after rollback. The standalone image has a native Python healthcheck.

No automatic installation on the reference server is part of publication.

## Verification scope

The automated checks exercise Discord command registration payloads, native
embed/component limits, access changes, confirmation expiry and replay,
navigation callbacks, background-refresh cancellation, release notes and sizes,
rollback selection, schedule policy, restart recovery, local HTTP panel fixtures,
the old archive validator and Linux image imports. Agent and maintenance tests
continue to cover Docker discovery, host identity and update/rollback handling.

These checks do not establish a live Discord gateway connection or change a
production container. The first OTA installation still needs a real Discord
client check of slash registration, reconnect completion, mobile layout and
integration credentials. The Ubuntu/Runtipi/Crafty/Jellyfin setup described in
the README is the existing v0.4 reference setup, not a claim of a v0.5 live test.
Testers are welcome, especially for other panels and homelab configurations.
