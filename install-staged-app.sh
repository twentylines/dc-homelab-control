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
command -v python3 >/dev/null 2>&1 || {
  echo "Python 3 is required to validate the Runtipi release metadata." >&2
  exit 1
}

# Keep the app version, Compose image tags and pull policy coupled.  This is a
# source-only check: it never reads secrets and never talks to Docker.
python3 "$BUILD_DIR/scripts/validate-runtipi-app.py"

STAGE_DIR="${APP_DIR}.staging.$$"
trap 'rm -rf "$STAGE_DIR"' EXIT INT TERM
install -d -m 755 "$STAGE_DIR/metadata" "$APP_DIR/metadata"
install -m 644 "$BUILD_DIR/app/config.json" "$STAGE_DIR/config.json"
install -m 644 "$BUILD_DIR/app/docker-compose.yml" "$STAGE_DIR/docker-compose.yml"
install -m 644 "$BUILD_DIR/app/metadata/description.md" "$STAGE_DIR/metadata/description.md"

# Replace only the three tracked app-payload files.  Runtipi's generated
# Compose file and app-data are deliberately left alone; Runtipi will
# regenerate its runtime definition when the administrator selects Update.
mv "$STAGE_DIR/config.json" "$APP_DIR/config.json"
mv "$STAGE_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"
mv "$STAGE_DIR/metadata/description.md" "$APP_DIR/metadata/description.md"
rm -rf "$STAGE_DIR"
trap - EXIT INT TERM

version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$APP_DIR/config.json")
echo "Homelab Control v$version is staged at $APP_DIR. Review Runtipi's generated compose configuration, then select Update in the Runtipi UI. No containers were started."

GENERATED_COMPOSE="$APP_DIR/docker-compose.generated.yml"
if [ -f "$GENERATED_COMPOSE" ] && ! grep -q "dc-homelab-control-agent:$version" "$GENERATED_COMPOSE"; then
  echo "Warning: Runtipi's generated Compose file still references another release. Select Update for this app before saving settings; the generated file is left untouched by this helper." >&2
fi
