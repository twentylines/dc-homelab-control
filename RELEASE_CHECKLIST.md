# Release checklist

- [ ] Confirm the `source` and `website` values in `app/config.json` point to
      the real public project URLs.
- [ ] Push a version tag and confirm the release workflow publishes the source
      archive, checksum and reproducible `amd64`/`arm64` images.
- [ ] Make the GHCR agent and bot packages public before sharing the Runtipi
      app definition.
- [ ] Run Python unit tests, Node tests, JavaScript syntax checks and
      JSON/YAML validation.
- [ ] Install once as a disposable custom Runtipi app and verify onboarding
      with no optional providers.
- [ ] Verify a Jellyfin/Seerr/Arr stack reports missing components accurately,
      then verify a Plex stack and a `MEDIA_STACK_PROFILE=none` install.
- [ ] Verify Pi-hole and Technitium discovery, external read-only URLs, a
      non-standard container name, and a stopped container.
- [ ] Verify a Crafty fixture, a Pterodactyl/Pelican API fixture, and Docker
      Paper/Purpur discovery; verify that `paperless` is not misclassified.
- [ ] Verify `/minecraft` reports per-server CPU/RAM/PIDs and hides controls in
      Docker-only mode.
- [ ] Verify admin/guest whitelists and that protected containers never receive
      action buttons.
- [ ] Review Docker socket exposure and the host-maintenance bridge separately
      before enabling updates or reboots.
- [ ] Submit to a community or own Runtipi app store only after the public
      repository and image signatures are available.
