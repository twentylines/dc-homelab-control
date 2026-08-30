#!/bin/sh
set -eu

# Install the root-owned bridge used for Ubuntu maintenance and verified
# Homelab Control releases.  This script never downloads a release and never
# starts or restarts containers; the bridge only acts on a signed, explicitly
# queued request from the authenticated controller.
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MAINTENANCE_DIR=${HOMELAB_CONTROL_MAINTENANCE_DIR:-/var/lib/homelab-control/maintenance}
CONFIG_DIR=/etc/homelab-control
CONFIG_FILE=$CONFIG_DIR/maintenance.env

test "$(id -u)" -eq 0 || {
  echo "Run this installer with sudo." >&2
  exit 1
}
test -f "$PROJECT_DIR/maintenance/homelab-control-maintenance-worker.py"
test -f "$PROJECT_DIR/maintenance/homelab-control-maintenance.service"

# Older Hades Control builds used the same request directory with a service
# named `hades-maintenance.service`.  Two workers must never consume that
# directory concurrently, so retire that legacy unit before enabling the
# maintained bridge.  This affects only the maintenance worker; it never
# stops or recreates application containers.
LEGACY_SERVICE=hades-maintenance.service
if systemctl list-unit-files "$LEGACY_SERVICE" --no-legend 2>/dev/null | grep -q "^$LEGACY_SERVICE"; then
  systemctl disable --now "$LEGACY_SERVICE" 2>/dev/null || true
fi

install -d -m 700 "$MAINTENANCE_DIR" "$CONFIG_DIR"
install -m 700 "$PROJECT_DIR/maintenance/homelab-control-maintenance-worker.py" /usr/local/sbin/homelab-control-maintenance-worker
install -m 644 "$PROJECT_DIR/maintenance/homelab-control-maintenance.service" /etc/systemd/system/homelab-control-maintenance.service

if [ ! -f "$CONFIG_FILE" ]; then
  umask 077
  cat > "$CONFIG_FILE" <<EOF
# Homelab Control root bridge configuration. Keep this file root-readable.
HOMELAB_CONTROL_MAINTENANCE_DIR=$MAINTENANCE_DIR
HOMELAB_CONTROL_REPOSITORY=
HOMELAB_CONTROL_COMPOSE_FILE=
HOMELAB_CONTROL_ENV_FILE=
HOMELAB_CONTROL_COMPOSE_PROJECT=
HOMELAB_CONTROL_RELEASE_ROOT=$MAINTENANCE_DIR/releases
EOF
  chmod 600 "$CONFIG_FILE"
fi

systemctl daemon-reload
systemctl enable --now homelab-control-maintenance.service
echo "Homelab Control maintenance bridge installed. Edit $CONFIG_FILE to enable verified bot releases; no app containers were changed."
