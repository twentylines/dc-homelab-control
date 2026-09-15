# Runtipi packaging and updates

Homelab Control is packaged as a versioned Runtipi app. The app version in
`app/config.json` and the two GHCR image tags in `app/docker-compose.yml` are
one release unit. Do not update either image with `docker pull` and leave the
Runtipi app definition on an older version: the next Runtipi settings save can
recreate the containers from that older generated definition.

## Safe release flow

1. Run the offline test suite and `python3 scripts/validate-runtipi-app.py`.
   The validator fails if the app version, both image tags, or the pull policy
   disagree.
2. Publish the matching Git tag and GitHub release. The release workflow builds
   the exact amd64 image tags referenced by the app definition.
3. Make the GHCR packages readable by the target Runtipi host.
4. Stage the reviewed payload on a host when needed:

   ```sh
   sudo ./install-staged-app.sh
   ```

   This replaces only `config.json`, `docker-compose.yml`, and the description
   under the app directory. It does not edit Runtipi's generated Compose file,
   remove app-data, or start/recreate Docker containers.
5. In Runtipi, open the app and select **Update**. Runtipi then regenerates its
   Compose definition and pulls the exact versioned images. Review the generated
   definition before confirming. Do not edit `docker-compose.generated.yml` by
   hand; it is Runtipi-owned output.

## Using a private custom app store

Runtipi 4.x supports a GitHub-backed custom app store. A store repository uses
this layout:

```text
apps/
  homelab-control/
    config.json
    docker-compose.yml
    metadata/description.md
    metadata/logo.jpg       # optional but recommended for a polished listing
```

Copy the reviewed `app/` payload into `apps/homelab-control/` in a store
repository, commit the same version as the GitHub release, and add that
repository in **Runtipi → Settings → App Stores → Add App Store**. After the
store refreshes, install or update Homelab Control from the Runtipi UI. A
custom store is immediate and private to the hosts that add it; submission to
the community store is a separate review process.

The Runtipi platform itself is not upgraded by a Docker image update. App
updates and platform updates are separate operations. This project keeps them
safe by pinning immutable image tags and checking the app/image release identity
in CI before a release can be published. `force_pull` remains false so a host
using a deliberately pinned local recovery image is not forced to pull a
nonexistent registry tag; selecting **Update** after a new version stages the
new immutable image explicitly.

## Configuration safety

Keep Discord tokens, provider API keys, webhook URLs and host-specific paths in
Runtipi's private form/app-data configuration. They are not part of the store
payload. The Docker socket is mounted only into the read-only discovery agent;
the Discord bot has no Docker socket access. Crafty TLS verification remains
enabled by default. If a Crafty installation uses a self-signed certificate,
copy only its public certificate into the bot app-data `data/bot` directory and
set `CRAFTY_CA_CERT_FILE=/data/crafty-ca.pem` in the private Runtipi form (add
`CRAFTY_TLS_SERVERNAME` only when the certificate name differs from the
internal service hostname). This trusts one certificate for Crafty without
changing trust for other integrations. Never copy Crafty’s private key. Only
an administrator who accepts the trade-off should set
`CRAFTY_ALLOW_INSECURE_TLS=true` as the explicit private-network fallback.
