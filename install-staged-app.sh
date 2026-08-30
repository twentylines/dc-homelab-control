#!/bin/sh
set -eu

# Optional local staging helper.  It copies only the Runtipi app definition;
# it never starts containers, changes the host firewall, or installs a root
# maintenance bridge.  Set ROOT_FOLDER_HOST when Runtipi is not in its
# default location.
BUILD_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=${ROOT_FOLDER_HOST:-/opt/runtipi}
APP_DIR=${ROOT_DIR}/apps/_user/homelab-control

test "$(id -u)" -eq 0 || {
  echo "Run this staging helper with sudo." >&2
  exit 1
}
test -f "$BUILD_DIR/app/config.json"
test -f "$BUILD_DIR/app/docker-compose.yml"

install -d -m 755 "$APP_DIR/metadata"
install -m 644 "$BUILD_DIR/app/config.json" "$APP_DIR/config.json"
install -m 644 "$BUILD_DIR/app/docker-compose.yml" "$APP_DIR/docker-compose.yml"
install -m 644 "$BUILD_DIR/app/metadata/description.md" "$APP_DIR/metadata/description.md"

echo "Homelab Control is staged at $APP_DIR. Review the generated compose configuration, then install it from the Runtipi UI. No containers were started."
