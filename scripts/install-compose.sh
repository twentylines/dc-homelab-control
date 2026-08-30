#!/bin/sh
set -eu

# Safe local installer for a checkout of Homelab Control. It never sources the
# config file as shell code and it never removes existing containers or data.
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONFIG_FILE=${HOMELAB_CONTROL_CONFIG_FILE_ON_HOST:-"$PROJECT_DIR/config.env"}
COMPOSE_FILE=${HOMELAB_CONTROL_COMPOSE_FILE:-"$PROJECT_DIR/compose.local.yml"}
case "$CONFIG_FILE" in /*) ;; *) CONFIG_FILE="$PROJECT_DIR/$CONFIG_FILE" ;; esac
case "$COMPOSE_FILE" in /*) ;; *) COMPOSE_FILE="$PROJECT_DIR/$COMPOSE_FILE" ;; esac

if [ "${1:-}" = "--check" ]; then
  CHECK_ONLY=1
else
  CHECK_ONLY=0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine or Docker Desktop, then run this script again." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "The Docker Compose plugin is required (try: docker compose version)." >&2
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  mkdir -p "$(dirname "$CONFIG_FILE")"
  cp "$PROJECT_DIR/config.example.env" "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
  echo "Created $CONFIG_FILE. Fill the required Discord and controller values, then run this script again."
  exit 0
fi

value_for() {
  # Read one simple KEY=VALUE line without evaluating any shell syntax.
  key=$1
  sed -n "s/^${key}=//p" "$CONFIG_FILE" | head -n 1
}

missing=""
for key in CONTROL_TOKEN DISCORD_TOKEN DISCORD_CLIENT_ID DISCORD_GUILD_ID DISCORD_OWNER_ID; do
  value=$(value_for "$key")
  case "$value" in
    ""|replace-with-*|your-*|change-me*) missing="$missing $key" ;;
  esac
done
token=$(value_for CONTROL_TOKEN)
token_length=$(printf '%s' "$token" | wc -c | tr -d ' ')
if [ "$token_length" -lt 32 ]; then missing="$missing CONTROL_TOKEN(32+ characters)"; fi
if [ -n "$missing" ]; then
  echo "Configuration is incomplete. Set:$missing in $CONFIG_FILE, then run again." >&2
  exit 1
fi

resolve_path() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$PROJECT_DIR" "$1" ;;
  esac
}

configured_path() {
  value=$(value_for "$1")
  [ -n "$value" ] || value=$2
  resolve_path "$value"
}

app_data=$(configured_path APP_DATA_DIR data)
host_data=$(configured_path HOST_DATA_PATH data/host-app-data)
media_path=$(configured_path MEDIA_PATH media)
maintenance_dir=$(configured_path MAINTENANCE_DIR data/maintenance)
mkdir -p "$app_data/agent" "$app_data/bot" "$maintenance_dir" "$host_data" "$media_path"
chmod 600 "$CONFIG_FILE"

docker compose --env-file "$CONFIG_FILE" -f "$COMPOSE_FILE" config >/dev/null
echo "Configuration and compose definition are valid."
if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "Check only: no images were built and no containers were started."
  exit 0
fi

docker compose --env-file "$CONFIG_FILE" -f "$COMPOSE_FILE" build
docker compose --env-file "$CONFIG_FILE" -f "$COMPOSE_FILE" up -d
echo "Homelab Control is running. Check it with: docker compose --env-file $CONFIG_FILE -f $COMPOSE_FILE ps"
