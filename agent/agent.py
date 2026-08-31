#!/usr/bin/env python3
"""Minimal, allowlisted controller for the Homelab Control bot."""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import os
import re
import shutil
import socket
import ssl
import struct
import threading
import time
import platform
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse


def _load_optional_config_file():
    """Load a small, non-executable KEY=VALUE file before reading settings.

    A single mounted config file keeps a Runtipi form from becoming an
    integration checklist.  Non-empty environment variables supplied by
    Compose or Runtipi always win; this file fills in values that are absent or
    blank.  It is deliberately not a shell source operation, so command
    substitutions and other shell syntax are never evaluated.
    """
    path = Path(os.getenv("HOMELAB_CONTROL_CONFIG_FILE", "/data/config.env"))
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if os.environ.get(key) in (None, ""):
            os.environ[key] = value


_load_optional_config_file()


LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 8787
DOCKER_SOCKET = "/var/run/docker.sock"
TOKEN_FILE = Path(os.getenv("CONTROL_TOKEN_FILE", "/run/secrets/control-token"))
HOST_PROC = Path(os.getenv("HOST_PROC", "/host/proc"))
HOST_HWMON = Path(os.getenv("HOST_HWMON", "/host/sys/class/hwmon"))
HOST_DMI = Path(os.getenv("HOST_DMI", "/host/sys/firmware/dmi/tables"))
HOST_HOSTNAME_FILE = Path(os.getenv("HOST_HOSTNAME_FILE", "/host/etc/hostname"))
HOST_OS_RELEASE_FILE = Path(os.getenv("HOST_OS_RELEASE_FILE", "/host/etc/os-release"))
HOST_SSD_PATH = Path(os.getenv("HOST_SSD_PATH", "/host/app-data"))
HOST_SSD_LABEL = os.getenv("HOST_SSD_LABEL", "Application data").strip() or "Application data"
HOST_MEDIA_PATH = Path(os.getenv("HOST_MEDIA_PATH", "/host/media"))
HOST_MEDIA_LABEL = os.getenv("HOST_MEDIA_LABEL", "Media").strip() or "Media"
HOST_GATEWAY = os.getenv("HOST_GATEWAY", "host.docker.internal")
DATA_DIR = Path(os.getenv("AGENT_DATA_DIR", "/data"))
SCRUTINY_URL = os.getenv("SCRUTINY_URL", f"http://{HOST_GATEWAY}:8085/api/summary")
JELLYFIN_BASE_URL = (os.getenv("JELLYFIN_BASE_URL", "").strip() or f"http://{HOST_GATEWAY}:8091").rstrip("/")
JELLYFIN_API_KEY = os.getenv("JELLYFIN_API_KEY", "").strip()
JELLYFIN_USER_ID = os.getenv("JELLYFIN_USER_ID", "").strip()
PLEX_BASE_URL = (os.getenv("PLEX_BASE_URL", "").strip() or f"http://{HOST_GATEWAY}:32400").rstrip("/")
PLEX_TOKEN = os.getenv("PLEX_TOKEN", "").strip()
RUNTIPI_ENV_FILE = Path(os.getenv("RUNTIPI_ENV_FILE", "/run/secrets/runtipi-env"))
MAINTENANCE_DIR = Path(os.getenv("MAINTENANCE_DIR", "/host/maintenance"))
HOST_UPDATE_NOTIFIER_DIR = Path(os.getenv("HOST_UPDATE_NOTIFIER_DIR", "/host/update-notifier"))
SYSTEM_STATUS_FILE = MAINTENANCE_DIR / "status.json"
SYSTEM_REQUEST_FILE = MAINTENANCE_DIR / "request.json"
RUNTIPI_API_URL = os.getenv("RUNTIPI_API_URL", "").strip().rstrip("/")
RUNTIPI_UPDATE_TIMEOUT = max(30, min(900, int(os.getenv("RUNTIPI_UPDATE_TIMEOUT", "240"))))
RUNTIPI_POLL_INTERVAL = max(2.0, min(15.0, float(os.getenv("RUNTIPI_POLL_INTERVAL", "4"))))
RUNTIPI_UPDATE_ALL_TIMEOUT = max(120, min(780, int(os.getenv("RUNTIPI_UPDATE_ALL_TIMEOUT", "720"))))
RUNTIPI_PROTECTED_APP_IDS = {"homelab-control", "hades-control", "backend", "runtipi"}
CONTROL_BOT_NAME = os.getenv("CONTROL_BOT_NAME", "Homelab Control").strip() or "Homelab Control"
HOMELAB_CONTROL_REPOSITORY = os.getenv("HOMELAB_CONTROL_REPOSITORY", "").strip()
HOMELAB_CONTROL_VERSION = os.getenv("HOMELAB_CONTROL_VERSION", "0.3.20").strip() or "0.3.20"
HOMELAB_CONTROL_RELEASE_CHANNEL = os.getenv("HOMELAB_CONTROL_RELEASE_CHANNEL", "stable").strip().lower() or "stable"
HOMELAB_CONTROL_RELEASE_ASSET = os.getenv("HOMELAB_CONTROL_RELEASE_ASSET", "").strip()
BOT_RELEASE_STATUS_FILE = MAINTENANCE_DIR / "bot-release.json"
BOT_RELEASE_CACHE_TTL = max(30.0, min(900.0, float(os.getenv("HOMELAB_CONTROL_RELEASE_CACHE_TTL", "300"))))
BOT_RELEASE_TIMEOUT = max(3.0, min(30.0, float(os.getenv("HOMELAB_CONTROL_RELEASE_TIMEOUT", "10"))))
CONTROL_MODE = os.getenv("SERVICE_CONTROL_MODE", "opt-out").strip().lower() or "opt-out"
if CONTROL_MODE not in {"opt-in", "opt-out"}:
    CONTROL_MODE = "opt-out"
CONTROL_POLICY_FILE = DATA_DIR / "control-policy.json"

HOST_UPDATE_SUPPORTED_OS_IDS = {"ubuntu", "debian", "linuxmint", "pop", "elementary"}

# Provider names in onboarding are intentionally forgiving.  People tend to
# write ``overseerr``/``seerr`` and ``qbit``/``qbittorrent`` interchangeably;
# normalising them here keeps the health output stable without requiring a
# specific Docker naming convention.
PROVIDER_ALIASES = {
    "overseerr": "seerr",
    "seerr": "seerr",
    "qbit": "qbittorrent",
    "qbittorrent": "qbittorrent",
    "pi-hole": "pihole",
    "pi_hole": "pihole",
    "pihole": "pihole",
    "technitiumdns": "technitium",
    "technitium-dns": "technitium",
    "plex-media-server": "plex",
}


def _normalise_provider_id(value):
    compact = re.sub(r"[^a-z0-9-]+", "", str(value or "").strip().lower())
    return PROVIDER_ALIASES.get(compact, compact)


def _provider_list(name):
    values = os.getenv(name, "").split(",")
    return tuple(dict.fromkeys(_normalise_provider_id(value) for value in values if str(value).strip()))


MEDIA_REQUIRED_PROVIDERS = _provider_list("MEDIA_REQUIRED_PROVIDERS")
NETWORK_REQUIRED_PROVIDERS = _provider_list("NETWORK_REQUIRED_PROVIDERS")
MEDIA_STACK_PROFILE = _normalise_provider_id(os.getenv("MEDIA_STACK_PROFILE", "auto")) or "auto"
_runtipi_cache_lock = threading.Lock()
_runtipi_cache_timestamp = 0.0
_runtipi_cache_value = None
_runtipi_update_lock = threading.Lock()
_bot_release_cache_lock = threading.Lock()
_bot_release_cache_timestamp = 0.0
_bot_release_cache_value = None
JELLYFIN_CACHE_TTL = 15.0
_jellyfin_cache_lock = threading.Lock()
_jellyfin_cache_timestamp = 0.0
_jellyfin_cache_value = None
PLEX_CACHE_TTL = 15.0
_plex_cache_lock = threading.Lock()
_plex_cache_timestamp = 0.0
_plex_cache_value = None


SERVICES = {
    "adguard": {"label": "AdGuard Home", "patterns": ("adguard_migrated-adguard-1",), "manageable": False},
    "archivebox": {"label": "ArchiveBox", "patterns": ("archivebox_migrated-archivebox-1",), "manageable": True},
    "beszel": {"label": "Beszel", "patterns": ("beszel_migrated-beszel-1",), "manageable": True},
    "changedetection": {"label": "ChangeDetection", "patterns": ("changedetection_migrated-changedetection-1",), "manageable": True},
    "crafty": {"label": "Crafty", "patterns": ("crafty_migrated-crafty-1",), "manageable": True},
    "home-assistant": {"label": "Home Assistant", "patterns": ("homeassistant-1_migrated-homeassistant-1-1",), "manageable": True},
    "homebridge": {"label": "Homebridge", "patterns": ("homebridge_migrated-homebridge-1",), "manageable": True},
    "jackett": {"label": "Jackett", "patterns": ("jackett_migrated-jackett-1",), "manageable": True},
    "jellyfin": {"label": "Jellyfin", "patterns": ("jellyfin",), "manageable": True},
    "paperless": {"label": "Paperless-ngx", "patterns": ("paperless-ngx_migrated-paperless-ngx-1",), "manageable": True},
    "prowlarr": {"label": "Prowlarr", "patterns": ("prowlarr_migrated-prowlarr-1",), "manageable": True},
    "qbittorrent": {"label": "qBittorrent", "patterns": ("qbittorrent_migrated-qbittorrent-1",), "manageable": True},
    "radarr": {"label": "Radarr", "patterns": ("radarr_migrated-radarr-1",), "manageable": True},
    "scrutiny": {"label": "Scrutiny", "patterns": ("scrutiny",), "manageable": True},
    "searxng": {"label": "SearXNG", "patterns": ("searxng_migrated-searxng-1",), "manageable": True},
    "seerr": {"label": "Seerr", "patterns": ("seerr_migrated-seerr-1",), "manageable": True},
    "sonarr": {"label": "Sonarr", "patterns": ("sonarr_migrated-sonarr-1",), "manageable": True},
    "syncthing": {"label": "Syncthing", "patterns": ("syncthing_migrated-syncthing-1",), "manageable": True},
    "uptime-kuma": {"label": "Uptime Kuma", "patterns": ("uptime-kuma_migrated-uptime-kuma-1",), "manageable": True},
}


MEDIA_PROBES = {
    "Jellyfin": 8091,
    "Seerr": 5055,
    "Sonarr": 8989,
    "Radarr": 7878,
    "Prowlarr": 9696,
    "qBittorrent": 8133,
    "Jackett": 9117,
}


# Provider definitions are deliberately descriptive rather than prescriptive:
# only providers found in the live Docker catalogue (or explicitly configured)
# are returned.  This keeps a universal installation quiet when an optional
# application is not present while still recognising common homelab choices.
MEDIA_PROVIDER_DEFINITIONS = (
    {"id": "jellyfin", "label": "Jellyfin", "patterns": ("jellyfin",), "ports": (8096, 8091), "default_port": 8096},
    {"id": "plex", "label": "Plex", "patterns": ("plex",), "ports": (32400,), "default_port": 32400},
    {"id": "tautulli", "label": "Tautulli", "patterns": ("tautulli",), "ports": (8181,), "default_port": 8181},
    {"id": "emby", "label": "Emby", "patterns": ("emby",), "ports": (8096,), "default_port": 8096},
    {"id": "audiobookshelf", "label": "Audiobookshelf", "patterns": ("audiobookshelf", "audiobook-shelf"), "ports": (13378,), "default_port": 13378},
    {"id": "kavita", "label": "Kavita", "patterns": ("kavita",), "ports": (5000,), "default_port": 5000},
    {"id": "komga", "label": "Komga", "patterns": ("komga",), "ports": (25600,), "default_port": 25600},
    {"id": "navidrome", "label": "Navidrome", "patterns": ("navidrome",), "ports": (4533,), "default_port": 4533},
    {"id": "immich", "label": "Immich", "patterns": ("immich",), "ports": (2283,), "default_port": 2283},
    {"id": "seerr", "label": "Seerr", "patterns": ("seerr", "overseerr"), "ports": (5055, 5056), "default_port": 5055},
    {"id": "sonarr", "label": "Sonarr", "patterns": ("sonarr",), "ports": (8989,), "default_port": 8989},
    {"id": "radarr", "label": "Radarr", "patterns": ("radarr",), "ports": (7878,), "default_port": 7878},
    {"id": "lidarr", "label": "Lidarr", "patterns": ("lidarr",), "ports": (8686,), "default_port": 8686},
    {"id": "readarr", "label": "Readarr", "patterns": ("readarr",), "ports": (8787,), "default_port": 8787},
    {"id": "prowlarr", "label": "Prowlarr", "patterns": ("prowlarr",), "ports": (9696,), "default_port": 9696},
    {"id": "bazarr", "label": "Bazarr", "patterns": ("bazarr",), "ports": (6767,), "default_port": 6767},
    {"id": "qbittorrent", "label": "qBittorrent", "patterns": ("qbittorrent", "qbit"), "ports": (8080, 8133), "default_port": 8080},
    {"id": "transmission", "label": "Transmission", "patterns": ("transmission",), "ports": (9091,), "default_port": 9091},
    {"id": "sabnzbd", "label": "SABnzbd", "patterns": ("sabnzbd",), "ports": (8080,), "default_port": 8080},
    {"id": "nzbget", "label": "NZBGet", "patterns": ("nzbget",), "ports": (6789,), "default_port": 6789},
    {"id": "jackett", "label": "Jackett", "patterns": ("jackett",), "ports": (9117,), "default_port": 9117},
    {"id": "flaresolverr", "label": "FlareSolverr", "patterns": ("flaresolverr",), "ports": (8191,), "default_port": 8191},
)

NETWORK_PROVIDER_DEFINITIONS = (
    {"id": "adguard", "label": "AdGuard Home", "patterns": ("adguard", "adguardhome"), "ports": (3000, 80, 8104), "default_port": 3000},
    {"id": "pihole", "label": "Pi-hole", "patterns": ("pihole", "pi-hole"), "ports": (80, 8080), "default_port": 80},
    {"id": "technitium", "label": "Technitium DNS", "patterns": ("technitium", "technitiumdns", "dns-server"), "ports": (5380,), "default_port": 5380},
    {"id": "unbound", "label": "Unbound", "patterns": ("unbound",), "ports": (), "default_port": None},
    {"id": "coredns", "label": "CoreDNS", "patterns": ("coredns", "core-dns"), "ports": (), "default_port": None},
    {"id": "tailscale", "label": "Tailscale", "patterns": ("tailscale",), "ports": (), "default_port": None},
    {"id": "wireguard", "label": "WireGuard", "patterns": ("wireguard", "wg-easy", "wg_easy"), "ports": (51821,), "default_port": 51821},
)

MEDIA_STACK_PROFILES = {
    "full": ("{primary}", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"),
    "jellyfin": ("jellyfin", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"),
    "plex": ("plex", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"),
    "emby": ("emby", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"),
    "minimal": ("{primary}",),
}


def _provider_definition_label(provider_id):
    provider_id = _normalise_provider_id(provider_id)
    for definition in (*MEDIA_PROVIDER_DEFINITIONS, *NETWORK_PROVIDER_DEFINITIONS):
        if definition.get("id") == provider_id:
            return definition.get("label", provider_id)
    return _pretty_identifier(provider_id)


def _media_expected_ids(detected_ids):
    """Return the configured/inferred media contract without guessing silently.

    An explicit comma-separated requirement always wins.  Otherwise ``auto``
    treats a detected Jellyfin/Plex/Emby or Arr/download workload as a common
    full media stack.  Music/photo-only services remain unassessed until the
    administrator chooses a profile or requirement list.
    """
    explicit = tuple(dict.fromkeys(_normalise_provider_id(value) for value in MEDIA_REQUIRED_PROVIDERS if value))
    if explicit:
        return explicit, "configured"
    profile = MEDIA_STACK_PROFILE
    if profile in {"none", "off", "disabled"}:
        return (), "disabled"
    primary = next((provider for provider in ("jellyfin", "plex", "emby") if provider in detected_ids), None)
    ecosystem = {"seerr", "sonarr", "radarr", "lidarr", "readarr", "prowlarr", "bazarr", "qbittorrent", "transmission", "sabnzbd", "nzbget"}
    if profile == "auto":
        if not primary and not (set(detected_ids) & ecosystem):
            return (), "unconfigured"
        primary = primary or "jellyfin"
        template = MEDIA_STACK_PROFILES["full"]
    elif profile in MEDIA_STACK_PROFILES:
        primary = primary or (profile if profile in {"jellyfin", "plex", "emby"} else "jellyfin")
        template = MEDIA_STACK_PROFILES[profile]
    else:
        return (), "invalid"
    return tuple(dict.fromkeys(primary if item == "{primary}" else item for item in template)), profile


# These are local-only probes from the agent container to the host.  A 2xx,
# 3xx, 401, or 403 response means the application is alive and answering;
# redirects and login walls are expected for several of these services.  The
# probe is deliberately kept at the root page so it cannot mutate app state.
SERVICE_PROBES = {
    # These three applications use host networking.  Their listeners are
    # intentionally not reachable from the agent's bridge network, so a live
    # container is the correct local health signal for them.
    "adguard": {"port": 8104, "scheme": "http", "host_network": True},
    "archivebox": {"port": 8015, "scheme": "http"},
    "beszel": {"port": 8999, "scheme": "http"},
    "changedetection": {"port": 8257, "scheme": "http"},
    "crafty": {"port": 8456, "scheme": "https"},
    "home-assistant": {"port": 8123, "scheme": "http", "host_network": True},
    "homebridge": {"port": 8581, "scheme": "http", "host_network": True},
    "jackett": {"port": 9117, "scheme": "http"},
    "jellyfin": {"port": 8091, "scheme": "http"},
    "paperless": {"port": 8012, "scheme": "http"},
    "prowlarr": {"port": 9696, "scheme": "http"},
    "qbittorrent": {"port": 8133, "scheme": "http"},
    "radarr": {"port": 7878, "scheme": "http"},
    "scrutiny": {"port": 8085, "scheme": "http"},
    "searxng": {"port": 8127, "scheme": "http"},
    "seerr": {"port": 5055, "scheme": "http"},
    "sonarr": {"port": 8989, "scheme": "http"},
    "syncthing": {"port": 8090, "scheme": "http"},
    "uptime-kuma": {"port": 8125, "scheme": "http"},
}

SERVICE_CACHE_TTL = 4.0
_service_cache_lock = threading.Lock()
_service_cache_timestamp = 0.0
_service_cache_value = None
TASKS_CACHE_TTL = 5.0
_tasks_cache_lock = threading.Lock()
_tasks_cache_timestamp = 0.0
_tasks_cache_value = None
MEDIA_RESOURCES_CACHE_TTL = 5.0
_media_resources_cache_lock = threading.Lock()
_media_resources_cache_timestamp = 0.0
_media_resources_cache_value = None


REDACTIONS = [
    re.compile(r"(?i)(api[_-]?key|token|password|secret)(\s*[=:]\s*)[^\s&\"']+"),
    re.compile(r"https://discord\.com/api/webhooks/[^\s\"']+", re.I),
]


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: str, timeout: float = 10):
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def docker_request(method: str, path: str, body: bytes | None = None) -> tuple[int, bytes]:
    connection = UnixHTTPConnection(DOCKER_SOCKET, timeout=15)
    headers = {"Host": "localhost"}
    if body is not None:
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = str(len(body))
    connection.request(method, path, body=body, headers=headers)
    response = connection.getresponse()
    payload = response.read()
    status = response.status
    connection.close()
    return status, payload


def docker_json(path: str):
    status, payload = docker_request("GET", path)
    if status != 200:
        raise RuntimeError(f"Docker returned HTTP {status}")
    return json.loads(payload.decode("utf-8"))


def containers():
    return docker_json("/containers/json?all=true")


def container_names(container):
    return [name.lstrip("/") for name in container.get("Names", [])]


def container_labels(container):
    labels = container.get("Labels") if isinstance(container, dict) else None
    return labels if isinstance(labels, dict) else {}


def _normalise_identifier(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _pretty_identifier(value):
    """Turn a Docker/Runtipi identifier into a short user-facing label."""
    words = [word for word in re.split(r"[-_.]+", str(value or "").strip()) if word]
    if not words:
        return "Container"
    special = {
        "api": "API",
        "db": "DB",
        "dns": "DNS",
        "it": "IT",
        "nginx": "Nginx",
        "pids": "PIDs",
        "pxe": "PXE",
        "qbit": "qBittorrent",
        "redis": "Redis",
    }
    return " ".join(special.get(word.lower(), word[:1].upper() + word[1:]) for word in words)


def _container_app_id(container):
    labels = container_labels(container)
    urn = str(labels.get("runtipi.appurn") or "").strip()
    if urn:
        return urn.split(":", 1)[0].strip()
    return ""


def _container_service_name(container):
    labels = container_labels(container)
    return str(labels.get("com.docker.compose.service") or "").strip()


def _container_identifiers(container):
    """Return bounded, non-secret identifiers used for discovery and policy."""
    labels = container_labels(container)
    values = list(container_names(container))
    values.extend([
        str(container.get("Image") or ""),
        str(labels.get("com.docker.compose.service") or ""),
        str(labels.get("com.docker.compose.project") or ""),
        str(labels.get("runtipi.appurn") or ""),
    ])
    return " ".join(value.lower() for value in values if value)


def _container_matches_patterns(container, patterns):
    return _container_match_score(container, patterns) > 0


_DEPENDENCY_TOKENS = {
    "broker", "cache", "db", "database", "exporter", "init", "migrate",
    "postgres", "proxy", "queue", "redis", "sidecar", "worker",
}


def _identifier_tokens(value):
    return [token for token in re.split(r"[^a-z0-9]+", str(value or "").lower()) if token]


def _container_match_score(container, patterns):
    """Score a known-provider match so dependencies do not win over the app.

    Runtipi labels are shared by an app's database/cache containers.  A plain
    substring check therefore makes ``jellyfin-db`` look like Jellyfin when
    the real app is also present.  Prefer an exact Compose service or a
    name token, and discount dependency-shaped names while retaining image,
    project and Runtipi-label fallbacks for unusual installations.
    """
    if not isinstance(container, dict):
        return 0
    labels = container_labels(container)
    names = container_names(container)
    app_id = str(labels.get("runtipi.appurn") or "").split(":", 1)[0].strip()
    compose_service = str(labels.get("com.docker.compose.service") or "").strip()
    compose_project = str(labels.get("com.docker.compose.project") or "").strip()
    image = str(container.get("Image") or "")
    fields = [("app", app_id), ("service", compose_service), ("project", compose_project), ("image", image)]
    best = 0
    for raw_pattern in patterns or ():
        pattern = _normalise_identifier(raw_pattern)
        if not pattern:
            continue
        pattern_tokens = _identifier_tokens(raw_pattern)
        for kind, value in fields:
            normalised = _normalise_identifier(value)
            tokens = _identifier_tokens(value)
            if normalised == pattern:
                score = {"service": 140, "app": 110, "project": 55, "image": 80}[kind]
                if kind in {"app", "project"} and any(token in _DEPENDENCY_TOKENS for token in _identifier_tokens(compose_service)):
                    score -= 55
                best = max(best, score)
            elif pattern in tokens or pattern in normalised:
                score = {"service": 105, "app": 75, "project": 45, "image": 65}[kind]
                if kind in {"app", "project"} and any(token in _DEPENDENCY_TOKENS for token in _identifier_tokens(compose_service)):
                    score -= 40
                best = max(best, score)
        for name in names:
            name_tokens = _identifier_tokens(name)
            name_normalised = _normalise_identifier(name)
            if pattern in name_tokens:
                score = 120
            elif pattern in name_normalised:
                score = 90
            else:
                score = 0
            if score and any(token in _DEPENDENCY_TOKENS for token in name_tokens):
                app_is_terminal = name_tokens and name_tokens[-1] == pattern
                app_is_compose_instance = len(name_tokens) >= 2 and name_tokens[-2] == pattern and name_tokens[-1].isdigit()
                if not (app_is_terminal or app_is_compose_instance):
                    score -= 45
            best = max(best, score)
        # Multi-word patterns such as ``audiobook-shelf`` are compared in
        # their compact form as well as token-by-token.
        if pattern_tokens and pattern == _normalise_identifier("".join(pattern_tokens)):
            for name in names:
                if pattern == _normalise_identifier(name.rstrip("0123456789-_")):
                    best = max(best, 120)
    return best


def _container_public_ports(container):
    ports = []
    raw_ports = container.get("Ports") if isinstance(container, dict) else None
    for value in raw_ports if isinstance(raw_ports, list) else []:
        if not isinstance(value, dict):
            continue
        try:
            public = value.get("PublicPort")
            private = value.get("PrivatePort")
            if public:
                ports.append((int(public), int(private) if private else None))
        except (TypeError, ValueError):
            continue
    return sorted(set(ports))


def _provider_port(container, definition):
    return _provider_port_info(container, definition)[0]


def _provider_port_info(container, definition):
    """Return (host port, source) without guessing across unrelated ports."""
    wanted = set(definition.get("ports") or ())
    public = _container_public_ports(container)
    for host_port, private_port in public:
        if private_port in wanted or host_port in wanted:
            return host_port, "published"
    # A single non-standard published port is a useful, low-risk signal for
    # custom homelab mappings.  If Docker publishes several unrelated ports,
    # do not guess which one is the web UI; the process boundary remains the
    # only honest signal until an explicit provider URL is configured.
    if len(public) == 1:
        return public[0][0], "published"
    if len(public) > 1:
        return None, "ambiguous"
    return definition.get("default_port"), "default"


def _configured_provider_url(provider_id):
    """Use an explicitly configured endpoint only; never invent one as a discovery signal."""
    env_name = f"{provider_id.upper().replace('-', '_')}_BASE_URL"
    value = os.getenv(env_name, "").strip().rstrip("/")
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    return value


def _provider_rows(definitions, entries):
    """Discover installed providers and return only providers that exist."""
    rows = []
    for definition in definitions:
        matches = [entry for entry in entries if _container_match_score(entry, definition.get("patterns", ()))]
        explicit_url = _configured_provider_url(definition["id"])
        if not matches and not explicit_url:
            continue
        matches.sort(key=lambda entry: (
            _container_match_score(entry, definition.get("patterns", ())),
            entry.get("State") == "running",
            bool(_container_public_ports(entry)),
        ), reverse=True)
        container = matches[0] if matches else None
        published_ports = _container_public_ports(container) if container else []
        port, inferred_source = _provider_port_info(container, definition) if container else (None, "none")
        port_source = "configured" if explicit_url else inferred_source
        rows.append({
            "id": definition["id"],
            "label": definition["label"],
            "container": (container_names(container)[0] if container and container_names(container) else None),
            "container_id": (str(container.get("Id") or "")[:64] if container else None),
            "state": (str(container.get("State") or "unknown") if container else "external"),
            "port": port,
            "url": explicit_url or (f"http://{HOST_GATEWAY}:{port}" if port else None),
            "configured": bool(explicit_url),
            "port_source": port_source,
        })
    return rows


def _control_identity(container):
    """Build a stable policy key that survives a normal container recreation."""
    labels = container_labels(container)
    appurn = str(labels.get("runtipi.appurn") or "").strip()
    project = str(labels.get("com.docker.compose.project") or "").strip()
    service = _container_service_name(container)
    if appurn or project or service:
        return "|".join(part for part in (appurn, project, service) if part)[:240]
    image = str(container.get("Image") or "").strip()
    names = container_names(container)
    return "|".join(part for part in (image, names[0] if names else "") if part)[:240]


def _policy_read():
    raw = _read_json_file(CONTROL_POLICY_FILE)
    overrides = raw.get("overrides") if isinstance(raw.get("overrides"), dict) else {}
    clean = {}
    for key, value in overrides.items():
        if isinstance(key, str) and len(key) <= 240 and isinstance(value, bool):
            clean[key] = value
    mode = str(raw.get("mode") or CONTROL_MODE).lower()
    if mode not in {"opt-in", "opt-out"}:
        mode = CONTROL_MODE
    return {"version": 1, "mode": mode, "overrides": clean}


def _policy_write(policy):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary = CONTROL_POLICY_FILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(policy, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, CONTROL_POLICY_FILE)


def _is_protected_container(container):
    identifiers = _container_identifiers(container)
    protected_patterns = (
        "homelab-control", "hades-control", "runtipi", "runtipi-db", "runtipi-queue", "runtipi-reverse-proxy",
        "docker-proxy", "docker.sock",
    )
    return any(pattern in identifiers for pattern in protected_patterns)


def _control_allowed(container, policy=None):
    if not container or _is_protected_container(container):
        return False
    policy = policy or _policy_read()
    identity = _control_identity(container)
    if identity in policy["overrides"]:
        return bool(policy["overrides"][identity])
    return policy["mode"] == "opt-out"


def _policy_entry(service, policy):
    container = service.get("_container")
    identity = _control_identity(container) if container else ""
    protected = bool(container and _is_protected_container(container))
    override = policy["overrides"].get(identity) if identity else None
    enabled = bool(service.get("manageable"))
    return {
        "key": service.get("key"),
        "label": service.get("label"),
        "identity": identity,
        "enabled": enabled,
        "override": override,
        "protected": protected,
        "discovered": bool(service.get("discovered")),
    }


def _container_category(container):
    identifiers = _container_identifiers(container)
    # Minecraft images and server panels use several names (Paper, Purpur,
    # Fabric, Forge, Bedrock, etc.).  Use token boundaries here so a document
    # service such as ``paperless-ngx`` is not misclassified as a game server.
    minecraft_patterns = (
        "minecraft", "paper", "spigot", "purpur", "fabric", "forge", "folia",
        "velocity", "bedrock", "bungeecord", "waterfall", "arclight", "sponge",
        "quilt", "itzg/minecraft-server", "itzg/minecraft-bedrock-server",
    )
    if any(re.search(rf"(?<![a-z0-9]){re.escape(pattern)}(?![a-z0-9])", identifiers) for pattern in minecraft_patterns):
        return "minecraft"
    category_patterns = (
        ("media", ("jellyfin", "plex", "emby", "audiobookshelf", "kavita", "komga", "navidrome", "immich", "seerr", "overseerr", "sonarr", "radarr", "lidarr", "readarr", "prowlarr", "bazarr", "qbittorrent", "transmission", "sabnzbd", "nzbget", "jackett", "flaresolverr", "tautulli", "maintainerr", "tdarr")),
        ("network", ("adguard", "pihole", "pi-hole", "technitium", "unbound", "coredns", "tailscale", "wireguard", "wg-easy", "cloudflared")),
        ("documents", ("paperless", "archivebox", "bookstack", "docmost", "stirling", "linkwarden", "calibre")),
        ("monitoring", ("beszel", "scrutiny", "uptime-kuma", "grafana", "prometheus", "glances", "dozzle", "changedetection", "spiderfoot", "maigret")),
        ("home", ("home-assistant", "homeassistant", "homebridge", "syncthing", "node-red", "zigbee2mqtt", "esphome")),
        ("control", ("homelab-control", "hades-control")),
    )
    for category, patterns in category_patterns:
        if any(pattern in identifiers for pattern in patterns):
            return category
    return "other"


def _container_capabilities(container):
    category = _container_category(container)
    capabilities = [category]
    if category == "minecraft":
        capabilities.extend(("game-server", "minecraft"))
    identifiers = _container_identifiers(container)
    if category == "media":
        capabilities.append("media")
    if any(pattern in identifiers for pattern in ("jellyfin", "plex", "emby")):
        capabilities.append("library")
    if any(pattern in identifiers for pattern in ("pihole", "pi-hole", "adguard", "technitium")):
        capabilities.append("dns")
    if any(pattern in identifiers for pattern in ("sonarr", "radarr", "lidarr", "readarr", "prowlarr", "bazarr")):
        capabilities.append("arr")
    return sorted(set(capabilities))


def _container_display_label(container):
    """Derive a useful label without exposing arbitrary Docker label values."""
    names = container_names(container)
    image = str(container.get("Image") or "").lower()
    component = str(container_labels(container).get("homelab.control.component") or "").lower()
    lowered_names = {name.lower() for name in names}
    if component == "agent":
        return "Control agent"
    if component == "bot":
        return f"{CONTROL_BOT_NAME} (Discord bot)"

    app_id = _container_app_id(container)
    compose_service = _container_service_name(container)
    base = app_id or compose_service
    if not base and names:
        base = names[0]
    label = _pretty_identifier(base)
    if app_id and compose_service and _normalise_identifier(app_id) != _normalise_identifier(compose_service):
        label = f"{_pretty_identifier(app_id)} · {_pretty_identifier(compose_service)}"
    return label[:100]


def _container_scope(container):
    labels = container_labels(container)
    project = str(labels.get("com.docker.compose.project") or "").strip()
    app_id = _container_app_id(container)
    component = str(labels.get("homelab.control.component") or "").strip()
    if project == "runtipi":
        return "Runtipi core"
    if app_id:
        return "Runtipi app"
    if component in {"agent", "bot"} or "homelab-control" in str(container.get("Image") or "").lower() or "hades-control" in str(container.get("Image") or "").lower():
        return "Control plane"
    return "Docker container"


def _dynamic_service_key(container):
    container_id = str(container.get("Id") or "").strip().lower()
    if container_id:
        identity = re.sub(r"[^a-f0-9]", "", container_id)[:16]
    else:
        identity = hashlib.sha256("|".join(container_names(container)).encode("utf-8")).hexdigest()[:16]
    return f"container-{identity or 'unknown'}"


def _container_health(container):
    status_text = str(container.get("Status") or "")
    health_match = re.search(r"\((healthy|unhealthy|starting)\)", status_text, re.IGNORECASE)
    if health_match:
        return health_match.group(1).lower(), "docker"
    return ("process" if container.get("State") == "running" else "unhealthy"), "process"


def _matches_service_definition(container, key, definition):
    # Match by bounded name/image/project patterns as well as the stable
    # Runtipi/Compose labels.  A plain ``jellyfin-1`` container without labels
    # is just as valid as a generated Runtipi name; exact-name matching would
    # silently omit it from the known service catalogue.
    if _container_match_score(container, definition["patterns"]):
        return True
    app_id = _container_app_id(container).lower()
    compose_service = _container_service_name(container).lower()
    # Runtipi and Compose labels let known applications survive a harmless
    # container-name change without adding another hand-maintained pattern.
    return key.lower() in {app_id, compose_service}


def resolve_service(key: str, entries=None):
    definition = SERVICES.get(key)
    if not definition:
        return None, None
    entries = entries if entries is not None else containers()
    matches = [container for container in entries if _matches_service_definition(container, key, definition)]
    if matches:
        matches.sort(key=lambda container: (
            _container_match_score(container, definition["patterns"]),
            _container_service_name(container).lower() == key.lower(),
            container.get("State") == "running",
            bool(_container_public_ports(container)),
        ), reverse=True)
        return definition, matches[0]
    return definition, None


def resolve_any_service(key: str, entries=None):
    """Resolve both friendly built-ins and auto-discovered container keys."""
    entries = entries if entries is not None else containers()
    definition, container = resolve_service(key, entries)
    if definition:
        return definition, container
    for entry in entries:
        if _dynamic_service_key(entry) == key:
            return {
                "label": _container_display_label(entry),
                "patterns": (),
                "manageable": False,
                "discovered": True,
            }, entry
    return None, None


def http_probe(probe):
    """Return an honest, read-only HTTP reachability result for one service."""
    scheme = probe.get("scheme", "http")
    port = int(probe["port"])
    connection_type = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
    connection_kwargs = {"timeout": 1.5}
    if scheme == "https":
        connection_kwargs["context"] = ssl._create_unverified_context()
    started = time.monotonic()
    connection = connection_type(HOST_GATEWAY, port, **connection_kwargs)
    try:
        # HEAD keeps this check cheap: we validate that the app answers without
        # downloading a dashboard, login page, or media asset.
        connection.request("HEAD", "/", headers={"User-Agent": "HomelabControlHealth/1.0"})
        response = connection.getresponse()
        try:
            code = int(response.status)
        finally:
            response.close()
        elapsed_ms = round((time.monotonic() - started) * 1000)
        return {
            "health": "healthy" if code < 500 else "unhealthy",
            "health_detail": f"HTTP {code} • {elapsed_ms} ms",
            "latency_ms": elapsed_ms,
            "probe_type": "HTTP HEAD",
        }
    except (http.client.HTTPException, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", None) or exc
        return {"health": "unreachable", "health_detail": str(reason)[:80]}
    finally:
        connection.close()


def apply_service_health(output):
    """Probe known service listeners concurrently without touching containers."""
    probe_jobs = {}
    for service in output:
        if not service.get("container") or service.get("state") != "running":
            continue
        definition = SERVICE_PROBES.get(service.get("key"))
        if not definition or definition.get("host_network"):
            continue
        container = service.get("_container") or {}
        published = _container_public_ports(container)
        if not published:
            # A bridge-only container can be perfectly healthy while its web
            # listener is intentionally unpublished. Keep the process-level
            # check instead of probing an unrelated host port and reporting a
            # false red status.
            continue
        expected = definition.get("port")
        matching = [host for host, private in published if host == expected or private == expected]
        if len(matching) == 1:
            probe_jobs[service["key"]] = {**definition, "port": matching[0]}
        elif len(published) == 1:
            # One custom published port is a safe compatibility signal. With
            # several ports we deliberately avoid guessing which is HTTP.
            probe_jobs[service["key"]] = {**definition, "port": published[0][0]}
    results = {}
    with ThreadPoolExecutor(max_workers=min(10, max(1, len(probe_jobs)))) as pool:
        futures = {pool.submit(http_probe, probe): key for key, probe in probe_jobs.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result()
            except Exception as exc:  # Keep one broken probe from hiding the fleet.
                results[key] = {"health": "unreachable", "health_detail": exc.__class__.__name__, "probe_type": "HTTP HEAD"}

    for service in output:
        result = results.get(service["key"])
        if SERVICE_PROBES.get(service["key"], {}).get("host_network") and service["state"] == "running":
            service["health"] = "process"
            service["health_detail"] = "host-network process alive; bridge probe not applicable"
        elif result:
            service.update(result)
        elif service["state"] == "running":
            # Preserve a Docker healthcheck result for auto-discovered
            # containers.  A container that reports ``healthy`` has already
            # supplied a real check; do not downgrade it to the weaker
            # process-only signal just because no HTTP probe is configured.
            if service.get("health_source") == "docker" and service.get("health") in {"healthy", "unhealthy", "starting"}:
                continue
            # A service without a configured HTTP endpoint is still checked at
            # the container boundary, but is not claimed to be application-
            # healthy.  This is not red unless it is actually stopped/missing.
            service["health"] = "process"
            service["health_source"] = "process"
            service["health_detail"] = "container process alive"
        else:
            service["health"] = "unhealthy"
            service["health_source"] = "process"
            service["health_detail"] = f"container {service['state']}"
    return output


def _discovered_service(container):
    state = str(container.get("State") or "unknown")
    status_text = str(container.get("Status") or "")
    health, health_source = _container_health(container)
    names = container_names(container)
    name = names[0] if names else str(container.get("Id") or "container")[:12]
    labels = container_labels(container)
    return {
        "key": _dynamic_service_key(container),
        "label": _container_display_label(container),
        "container": name,
        "container_id": str(container.get("Id") or "")[:64],
        "state": state,
        "health": health,
        "health_source": health_source,
        "health_detail": status_text or ("container process alive" if state == "running" else f"container {state}"),
        "status": status_text,
        "image": str(container.get("Image") or "unknown")[:200],
        "scope": _container_scope(container),
        "compose_project": str(labels.get("com.docker.compose.project") or "")[:100],
        "compose_service": _container_service_name(container)[:100],
        "runtipi_app": _container_app_id(container)[:100],
        "manageable": False,
        "discovered": True,
    }


def service_list():
    global _service_cache_timestamp, _service_cache_value
    now = time.monotonic()
    with _service_cache_lock:
        if _service_cache_value is not None and now - _service_cache_timestamp < SERVICE_CACHE_TTL:
            return [service.copy() for service in _service_cache_value]

    entries = containers()
    output = []
    represented_ids = set()
    policy = _policy_read()
    for key, definition in SERVICES.items():
        _, container = resolve_service(key, entries)
        # A universal catalogue should be quiet about optional software that
        # is not installed.  It still keeps the familiar label whenever the
        # provider is present.
        if not container:
            continue
        state = container.get("State", "unknown")
        status_text = container.get("Status", "")
        health, health_source = _container_health(container)
        container_id = str(container.get("Id") or "")
        if container_id:
            represented_ids.add(container_id)
        output.append(
            {
                "key": key,
                "label": definition["label"],
                "container": container_names(container)[0] if container_names(container) else container.get("Id", "")[:12],
                "container_id": container_id[:64],
                "state": state,
                "health": health,
                "health_source": health_source,
                "health_detail": status_text or "container process alive",
                "status": status_text,
                "image": str(container.get("Image") or "unknown")[:200],
                "scope": "Runtipi app" if _container_app_id(container) else _container_scope(container),
                "compose_project": str(container_labels(container).get("com.docker.compose.project") or "")[:100],
                "compose_service": _container_service_name(container)[:100],
                "runtipi_app": _container_app_id(container)[:100],
                "category": _container_category(container),
                "capabilities": _container_capabilities(container),
                "manageable": _control_allowed(container, policy),
                "protected": _is_protected_container(container),
                "discovered": False,
                "identity": _control_identity(container),
                "_container": container,
            }
        )

    # The service catalogue is intentionally additive: known entries retain
    # their friendly labels, probes, and action allowlist, while every other
    # Docker container is surfaced automatically from the live daemon.  This
    # is what makes renamed/replaced apps (for example filebrowser-quantum)
    # appear without another code change.
    discovered = []
    for container in entries:
        if str(container.get("Id") or "") in represented_ids:
            continue
        row = _discovered_service(container)
        row["manageable"] = _control_allowed(container, policy)
        row["protected"] = _is_protected_container(container)
        row["identity"] = _control_identity(container)
        row["category"] = _container_category(container)
        row["capabilities"] = _container_capabilities(container)
        row["_container"] = container
        discovered.append(row)
    discovered.sort(key=lambda service: (service["state"] != "running", service["label"].lower(), service["container"].lower()))
    output.extend(discovered)
    output = apply_service_health(output)
    # Container objects are an internal implementation detail; never return
    # their full inspect/list payload over the controller API.
    for service in output:
        service.pop("_container", None)
    with _service_cache_lock:
        _service_cache_timestamp = time.monotonic()
        _service_cache_value = [service.copy() for service in output]
    return output


def control_policy():
    """Return the current safe service-control policy and live identities."""
    policy = _policy_read()
    entries = service_list()
    services = []
    for service in entries:
        identity = str(service.get("identity") or "")
        override = policy["overrides"].get(identity) if identity else None
        services.append({
            "key": service.get("key"),
            "label": service.get("label"),
            "container": service.get("container"),
            "category": service.get("category", "other"),
            "discovered": bool(service.get("discovered")),
            "manageable": bool(service.get("manageable")),
            "protected": bool(service.get("protected")),
            "enabled": bool(service.get("manageable")),
            "override": override,
            "identity": identity,
        })
    mode_description = (
        "Detected containers are controllable by default; protected containers and any explicit opt-outs stay read-only"
        if policy["mode"] == "opt-out"
        else "Detected containers are read-only by default; an administrator must explicitly enable each control"
    )
    return {
        "version": 1,
        "mode": policy["mode"],
        "default": "controls disabled until an administrator enables them" if policy["mode"] == "opt-in" else "controls enabled unless an administrator disables them",
        "mode_description": mode_description,
        "protected_defaults": "Control plane, Runtipi core, Docker plumbing and the controller itself remain protected",
        "services": services,
    }


def set_control_mode(mode: str, actor_id: str, actor_name: str):
    mode = str(mode or "").strip().lower()
    if mode not in {"opt-in", "opt-out"}:
        raise ValueError("mode must be opt-in or opt-out")
    policy = _policy_read()
    if policy["mode"] != mode:
        policy["mode"] = mode
        _policy_write(policy)
        with _service_cache_lock:
            global _service_cache_timestamp
            _service_cache_timestamp = 0
        append_audit({
            "actor_id": sanitize_audit_value(actor_id),
            "actor_name": sanitize_audit_value(actor_name),
            "action": "control_mode",
            "service": "all containers",
            "result": mode,
        })
    return control_policy()


def set_control_policy(key: str, enabled: bool, actor_id: str, actor_name: str):
    if not isinstance(enabled, bool):
        raise ValueError("enabled must be a boolean")
    if not re.fullmatch(r"(?:[a-z0-9][a-z0-9._-]{0,80})", str(key or ""), re.IGNORECASE):
        raise ValueError("Invalid service key")
    entries = containers()
    definition, container = resolve_any_service(key, entries)
    if not container:
        raise KeyError("Service no longer exists")
    if _is_protected_container(container):
        raise PermissionError("This container is protected from remote controls")
    policy = _policy_read()
    identity = _control_identity(container)
    policy["overrides"][identity] = enabled
    _policy_write(policy)
    with _service_cache_lock:
        global _service_cache_timestamp
        _service_cache_timestamp = 0
    append_audit({
        "actor_id": sanitize_audit_value(actor_id),
        "actor_name": sanitize_audit_value(actor_name),
        "action": "control_policy",
        "service": str(definition.get("label") or key)[:100],
        "result": "enabled" if enabled else "disabled",
    })
    return control_policy()


def _resource_float(value):
    try:
        number = float(value)
        return number if number >= 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


def _docker_memory(stats, host_total):
    memory = stats.get("memory_stats") if isinstance(stats, dict) else None
    memory = memory if isinstance(memory, dict) else {}
    raw_usage = _resource_float(memory.get("usage"))
    memory_stats = memory.get("stats") if isinstance(memory.get("stats"), dict) else {}
    # Docker's reported usage includes page cache on some engines.  Prefer
    # inactive_file (cgroup v2), then the older cache field, to match the
    # memory figure users see in `docker stats` as closely as possible.
    cache = memory_stats.get("inactive_file")
    if cache is None:
        cache = memory_stats.get("total_inactive_file")
    if cache is None:
        cache = memory_stats.get("cache", 0)
    used = max(0.0, raw_usage - _resource_float(cache))
    raw_limit = _resource_float(memory.get("limit"))
    # An unlimited container is commonly represented by a very large integer.
    limit = raw_limit if 0 < raw_limit < 2**60 else None
    denominator = limit or (float(host_total) if host_total else 0.0)
    percent = (used / denominator * 100) if denominator else None
    return used, limit, percent, "limit" if limit else "host"


def _docker_cpu_percent(stats):
    current = stats.get("cpu_stats") if isinstance(stats, dict) else None
    previous = stats.get("precpu_stats") if isinstance(stats, dict) else None
    current = current if isinstance(current, dict) else {}
    previous = previous if isinstance(previous, dict) else {}
    current_cpu = current.get("cpu_usage") if isinstance(current.get("cpu_usage"), dict) else {}
    previous_cpu = previous.get("cpu_usage") if isinstance(previous.get("cpu_usage"), dict) else {}
    cpu_delta = _resource_float(current_cpu.get("total_usage")) - _resource_float(previous_cpu.get("total_usage"))
    system_delta = _resource_float(current.get("system_cpu_usage")) - _resource_float(previous.get("system_cpu_usage"))
    if cpu_delta <= 0 or system_delta <= 0:
        return None
    online = _resource_float(current.get("online_cpus"))
    if not online:
        per_cpu = current_cpu.get("percpu_usage")
        online = len(per_cpu) if isinstance(per_cpu, list) else 1
    return round(max(0.0, cpu_delta / system_delta * online * 100), 1)


def _resource_label(entry):
    names = {name.lower() for name in container_names(entry)}
    image = str(entry.get("Image") or "").lower()
    component = str(container_labels(entry).get("homelab.control.component") or "").lower()
    if component == "agent" or "homelab-control-agent" in image:
        return "Control agent"
    if component == "bot" or "homelab-control-bot" in image:
        return f"{CONTROL_BOT_NAME} (Discord bot)"
    for definition in SERVICES.values():
        if any(pattern.lower() in names for pattern in definition["patterns"]):
            return definition["label"]
    name = container_names(entry)[0] if container_names(entry) else str(entry.get("Id", "container"))[:12]
    return name.replace("_", " ").replace("-", " ").title()


def _container_resources(entry, host_total):
    container_id = str(entry.get("Id") or "").strip()
    if not container_id:
        return None, "unknown container"
    try:
        stats = docker_json(f"/containers/{quote(container_id, safe='')}/stats?stream=false")
        used, limit, percent, scope = _docker_memory(stats, host_total)
        networks = stats.get("networks") if isinstance(stats, dict) and isinstance(stats.get("networks"), dict) else {}
        rx = sum(_resource_float(value.get("rx_bytes")) for value in networks.values() if isinstance(value, dict))
        tx = sum(_resource_float(value.get("tx_bytes")) for value in networks.values() if isinstance(value, dict))
        pids_stats = stats.get("pids_stats") if isinstance(stats, dict) and isinstance(stats.get("pids_stats"), dict) else {}
        pids = pids_stats.get("current")
        try:
            pids = int(pids) if pids is not None else None
        except (TypeError, ValueError):
            pids = None
        name = container_names(entry)[0] if container_names(entry) else container_id[:12]
        label = _resource_label(entry)
        return {
            "id": container_id[:64],
            "name": name,
            "label": label,
            "role": "discord-bot" if "(Discord bot)" in label else "service",
            "image": str(entry.get("Image") or "unknown"),
            "memory_used": round(used),
            "memory_limit": round(limit) if limit is not None else None,
            "memory_percent": round(percent, 1) if percent is not None else None,
            "memory_scope": scope,
            "cpu_percent": _docker_cpu_percent(stats),
            "pids": pids,
            "network_rx": round(rx),
            "network_tx": round(tx),
        }, None
    except Exception as exc:
        return None, f"{container_names(entry)[0] if container_names(entry) else container_id[:12]} ({exc.__class__.__name__})"


def docker_resources(force=False):
    """Return a cached, on-demand read-only Docker resource snapshot."""
    global _tasks_cache_timestamp, _tasks_cache_value
    started = time.monotonic()
    now = time.monotonic()
    with _tasks_cache_lock:
        if not force and _tasks_cache_value is not None and now - _tasks_cache_timestamp < TASKS_CACHE_TTL:
            return json.loads(json.dumps(_tasks_cache_value))
    try:
        entries = [entry for entry in containers() if entry.get("State") == "running"]
        host_memory = memory_stats()
        rows = []
        failed = []
        # The stats calls are independent, and this endpoint is on-demand;
        # using a wider bounded pool shortens the wait for a large stack while
        # keeping the Docker daemon work read-only and finite.
        with ThreadPoolExecutor(max_workers=min(16, max(1, len(entries)))) as pool:
            futures = {pool.submit(_container_resources, entry, host_memory["total"]): entry for entry in entries}
            for future in as_completed(futures):
                row, error = future.result()
                if row:
                    rows.append(row)
                elif error:
                    failed.append(error)
        rows.sort(key=lambda item: (item.get("memory_used") or 0, item.get("cpu_percent") or 0), reverse=True)
        docker_memory = sum(item.get("memory_used") or 0 for item in rows)
        docker_cpu = sum(item.get("cpu_percent") or 0 for item in rows)
        discord_bot = next((item for item in rows if item.get("role") == "discord-bot"), None)
        result = {
            "available": True,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "host_memory": host_memory,
            "docker": {
                "running": len(entries),
                "sampled": len(rows),
                "failed": len(failed),
                "memory_used": docker_memory,
                "cpu_percent": round(docker_cpu, 1),
            },
            "sample_duration_ms": round((time.monotonic() - started) * 1000),
            "discord_bot": discord_bot,
            "containers": rows,
            "failed": failed[:20],
            "detail": "On-demand Docker stats; no continuous sampler is running",
        }
    except Exception as exc:
        result = {
            "available": False,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "host_memory": {},
            "docker": {"running": 0, "sampled": 0, "failed": 0, "memory_used": 0, "cpu_percent": None},
            "sample_duration_ms": round((time.monotonic() - started) * 1000),
            "discord_bot": None,
            "containers": [],
            "failed": [],
            "detail": f"Docker resource snapshot unavailable: {exc.__class__.__name__}",
        }
    with _tasks_cache_lock:
        _tasks_cache_timestamp = time.monotonic()
        _tasks_cache_value = result
    return json.loads(json.dumps(result))


def media_resources(force=False):
    """Return a small, cached resource sample for detected media containers."""
    global _media_resources_cache_timestamp, _media_resources_cache_value
    started = time.monotonic()
    now = time.monotonic()
    with _media_resources_cache_lock:
        if not force and _media_resources_cache_value is not None and now - _media_resources_cache_timestamp < MEDIA_RESOURCES_CACHE_TTL:
            return json.loads(json.dumps(_media_resources_cache_value))

    detected = []
    try:
        entries = containers()
        host_memory = memory_stats()
        running_entries = []
        not_running = []
        seen_ids = set()
        detected = [entry for entry in entries if _container_category(entry) == "media"]
        for entry in detected:
            container_id = str(entry.get("Id") or "")
            if entry.get("State") != "running":
                not_running.append(_container_display_label(entry))
                continue
            if not container_id or container_id in seen_ids:
                continue
            seen_ids.add(container_id)
            running_entries.append(entry)

        rows = []
        failed = []
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(running_entries)))) as pool:
            futures = {
                pool.submit(_container_resources, entry, host_memory["total"]): entry
                for entry in running_entries
            }
            for future in as_completed(futures):
                row, error = future.result()
                if row:
                    rows.append(row)
                elif error:
                    failed.append(error)

        rows.sort(key=lambda item: (item.get("memory_used") or 0, item.get("cpu_percent") or 0), reverse=True)
        cpu_values = [item["cpu_percent"] for item in rows if item.get("cpu_percent") is not None]
        result = {
            "available": True,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "running": len(running_entries),
            "total": len(detected),
            "sampled": len(rows),
            "failed": failed[:20],
            "not_running": not_running,
            "memory_used": sum(item.get("memory_used") or 0 for item in rows),
            "cpu_percent": round(sum(cpu_values), 1) if cpu_values else None,
            "sample_duration_ms": round((time.monotonic() - started) * 1000),
            "detail": "On-demand stats for running media containers; no continuous sampler is running",
        }
    except Exception as exc:
        result = {
            "available": False,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "running": 0,
            "total": len(detected),
            "sampled": 0,
            "failed": [],
            "not_running": [],
            "memory_used": 0,
            "cpu_percent": None,
            "sample_duration_ms": round((time.monotonic() - started) * 1000),
            "detail": f"Media resource sample unavailable: {exc.__class__.__name__}",
        }
    with _media_resources_cache_lock:
        _media_resources_cache_timestamp = time.monotonic()
        _media_resources_cache_value = result
    return json.loads(json.dumps(result))


def read_cpu():
    values = [int(value) for value in (HOST_PROC / "stat").read_text().splitlines()[0].split()[1:]]
    idle = values[3] + values[4]
    return sum(values), idle


def cpu_usage():
    total_a, idle_a = read_cpu()
    time.sleep(0.25)
    total_b, idle_b = read_cpu()
    delta_total = total_b - total_a
    if delta_total <= 0:
        return 0.0
    return max(0.0, min(100.0, 100 * (1 - ((idle_b - idle_a) / delta_total))))


def memory_stats():
    values = {}
    for line in (HOST_PROC / "meminfo").read_text().splitlines():
        key, raw = line.split(":", 1)
        values[key] = int(raw.strip().split()[0]) * 1024
    total = values["MemTotal"]
    used = total - values["MemAvailable"]
    swap_total = values.get("SwapTotal", 0)
    swap_used = swap_total - values.get("SwapFree", 0)
    return {"used": used, "total": total, "swap_used": swap_used, "swap_total": swap_total}


def cpu_temperature():
    temperatures = []
    # Some Docker/sysfs combinations expose the host sensor tree through the
    # container's normal read-only /sys view but return an empty directory when
    # that same subtree is bind-mounted. Try the configured path first, then
    # the normal view; both are read-only.
    roots = [HOST_HWMON]
    normal_root = Path("/sys/class/hwmon")
    if normal_root != HOST_HWMON:
        roots.append(normal_root)
    for root in roots:
        if not root.exists():
            continue
        for directory in root.glob("hwmon*"):
            try:
                if (directory / "name").read_text().strip() != "coretemp":
                    continue
                for source in directory.glob("temp*_input"):
                    temperatures.append(float(source.read_text().strip()) / 1000)
            except (OSError, ValueError):
                continue
        if temperatures:
            break
    return max(temperatures) if temperatures else None


def scrutiny_drives():
    try:
        with urllib.request.urlopen(SCRUTINY_URL, timeout=8) as response:
            payload = json.load(response)
    except (OSError, ValueError, urllib.error.URLError):
        return []
    summaries = payload.get("data", {}).get("summary", {})
    drives = []
    for summary in summaries.values() if isinstance(summaries, dict) else []:
        try:
            device = summary.get("device", {})
            smart = summary.get("smart", {})
            model = device.get("model_name") or device.get("device_name") or "Unknown drive"
            status = int(device.get("device_status", -1))
            temperature = smart.get("temp")
            rotational = int(device.get("rotational_speed") or 0) > 0
            warm_limit = 55 if rotational else 70
            warm = temperature is not None and float(temperature) >= warm_limit
            drives.append(
                {
                    "model": model,
                    "state": "Healthy" if status == 0 else f"SMART status {status}",
                    "temperature_c": float(temperature) if temperature is not None else None,
                    "warning": status != 0 or warm,
                    "critical": status != 0,
                }
            )
        except (AttributeError, TypeError, ValueError):
            continue
    return drives


def disk_stats(path: Path, label: str):
    usage = shutil.disk_usage(path)
    return {
        "label": label,
        "used": usage.used,
        "total": usage.total,
        "free": usage.free,
        "percent": 100 * usage.used / usage.total if usage.total else 0,
    }


def host_specs():
    model = "Unknown CPU"
    frequencies = []
    try:
        for line in (HOST_PROC / "cpuinfo").read_text(errors="replace").splitlines():
            if line.lower().startswith("model name"):
                model = line.split(":", 1)[1].strip()
            elif line.lower().startswith("cpu mhz"):
                try:
                    frequencies.append(float(line.split(":", 1)[1].strip()) / 1000)
                except (IndexError, ValueError):
                    pass
    except OSError:
        pass
    try:
        cores = sum(1 for line in (HOST_PROC / "cpuinfo").read_text(errors="replace").splitlines() if line.startswith("processor"))
    except OSError:
        cores = 0
    try:
        kernel = (HOST_PROC / "sys/kernel/osrelease").read_text().strip()
    except OSError:
        kernel = platform.release()
    observed_ghz = round(sum(frequencies) / len(frequencies), 2) if frequencies else None
    return {
        "cpu_model": model,
        "observed_ghz": observed_ghz,
        "ram_speed_mhz": ram_speeds_mhz(),
        "logical_cores": cores,
        "architecture": platform.machine(),
        "kernel": kernel,
    }


def ram_speeds_mhz():
    """Read memory-device speed from the read-only SMBIOS DMI table when available."""
    table = HOST_DMI / "DMI"
    try:
        raw = table.read_bytes()
    except OSError:
        return []
    speeds = []
    position = 0
    while position + 4 <= len(raw):
        structure_type = raw[position]
        length = raw[position + 1]
        if length < 4 or position + length > len(raw):
            break
        formatted = raw[position : position + length]
        if structure_type == 17:
            # SMBIOS Memory Device: configured speed at 0x20, fallback speed at 0x15.
            for offset in (0x20, 0x15):
                if offset + 2 <= len(formatted):
                    speed = int.from_bytes(formatted[offset : offset + 2], "little")
                    if speed:
                        speeds.append(speed)
                        break
        end = position + length
        while end + 1 < len(raw) and raw[end : end + 2] != b"\x00\x00":
            end += 1
        position = end + 2
    return sorted(set(speeds))


def host_hostname():
    for path in (HOST_HOSTNAME_FILE, Path("/etc/hostname")):
        try:
            value = path.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            continue
        if value and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}", value):
            return value
    return platform.node() or "home-server"


def _clean_os_value(value, maximum=120):
    value = str(value or "").strip().strip('"').strip("'")
    value = re.sub(r"[\r\n]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value[:maximum]


def host_os():
    """Return a bounded host OS identity from the read-only os-release file."""
    for path in (HOST_OS_RELEASE_FILE, Path("/etc/os-release")):
        try:
            raw = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        values = {}
        for line in raw:
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key in {"ID", "NAME", "PRETTY_NAME", "VERSION_ID"}:
                values[key] = _clean_os_value(value)
        identifier = re.sub(r"[^a-z0-9._+-]", "", values.get("ID", "").lower())
        name = values.get("NAME") or identifier.title() or platform.system() or "Unknown OS"
        pretty = values.get("PRETTY_NAME") or name
        return {
            "id": identifier or "unknown",
            "name": name[:80],
            "pretty_name": pretty[:120],
            "version_id": values.get("VERSION_ID", "")[:40],
            "source": "os-release",
        }
    system = _clean_os_value(platform.system() or "Unknown OS", 80)
    identifier = re.sub(r"[^a-z0-9._+-]", "", system.lower()) or "unknown"
    return {"id": identifier, "name": system, "pretty_name": system, "version_id": "", "source": "runtime"}


def host_storage():
    candidates = ((HOST_SSD_PATH, HOST_SSD_LABEL), (HOST_MEDIA_PATH, HOST_MEDIA_LABEL))
    output = []
    seen = set()
    for path, label in candidates:
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path
        if resolved in seen or not path.exists():
            continue
        try:
            output.append(disk_stats(path, label))
            seen.add(resolved)
        except OSError:
            continue
    return output


def system_status():
    service_entries = service_list()
    running = sum(1 for service in service_entries if service["state"] == "running")
    unhealthy = [service["key"] for service in service_entries if service["health"] in {"unhealthy", "unreachable"}]
    all_containers = containers()
    all_running = sum(1 for container in all_containers if container.get("State") == "running")
    return {
        "hostname": host_hostname(),
        "os": host_os(),
        "specs": host_specs(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": int(float((HOST_PROC / "uptime").read_text().split()[0])),
        "cpu_percent": round(cpu_usage(), 1),
        "load": [float(value) for value in (HOST_PROC / "loadavg").read_text().split()[:3]],
        "temperature_c": cpu_temperature(),
        "drives": scrutiny_drives(),
        "memory": memory_stats(),
        "storage": host_storage(),
        "containers": {
            "running": all_running,
            "total": len(all_containers),
            "tracked_running": running,
            "tracked_total": len(service_entries),
            "unhealthy": unhealthy,
        },
    }


def media_status():
    entries = containers()
    output = []
    for provider in _provider_rows(MEDIA_PROVIDER_DEFINITIONS, entries):
        started = time.monotonic()
        online = False
        error = None
        latency = None
        state = provider.get("state")
        url = provider.get("url")
        endpoint_probe = bool(url and (provider.get("configured") or provider.get("port_source") == "published"))
        try:
            if endpoint_probe:
                parsed = urlparse(url)
                port = parsed.port or (443 if parsed.scheme == "https" else 80)
                with socket.create_connection((parsed.hostname, port), timeout=2):
                    online = True
            elif provider.get("container") and state == "running":
                # A running container with no published port is healthy at its
                # process boundary; it may be intentionally internal-only.
                online = True
        except (OSError, ValueError) as exc:
            error = exc.__class__.__name__
            # Do not mark an internal-only provider red just because its
            # optional host port is not published.
            if provider.get("container") and state == "running" and provider.get("port_source") == "default" and not provider.get("configured"):
                online = True
                error = None
        if online and endpoint_probe:
            latency = round((time.monotonic() - started) * 1000)
        output.append({
            "id": provider["id"],
            "label": provider["label"],
            "container": provider.get("container"),
            "port": provider.get("port"),
            "online": online,
            "latency_ms": latency,
            "error": error,
            "state": state,
            "health_source": "tcp" if endpoint_probe else "docker",
            "probe_type": "TCP connect" if endpoint_probe else None,
            "detail": "endpoint reachable" if endpoint_probe and online else "container running; endpoint is internal or unpublished" if online else "endpoint unavailable",
        })
    return output


def media_summary(rows=None):
    """Describe media-stack completeness using detected or configured providers."""
    rows = media_status() if rows is None else (rows if isinstance(rows, list) else [])
    detected_ids = tuple(dict.fromkeys(_normalise_provider_id(row.get("id")) for row in rows if isinstance(row, dict) and row.get("id")))
    expected_ids, source = _media_expected_ids(detected_ids)
    missing_ids = tuple(provider for provider in expected_ids if provider not in detected_ids)
    expected = [_provider_definition_label(provider) for provider in expected_ids]
    missing = [_provider_definition_label(provider) for provider in missing_ids]
    if source == "disabled":
        detail = "Media-stack completeness checks are disabled"
        assessed = False
        complete = None
    elif source == "invalid":
        detail = "Media-stack profile is invalid; choose auto, full, minimal, none, or an explicit requirement list"
        assessed = False
        complete = None
    elif not expected_ids:
        detail = "No media-stack profile is configured for the detected services"
        assessed = False
        complete = None
    elif missing:
        detail = f"Incomplete · missing {', '.join(missing)}"
        assessed = True
        complete = False
    else:
        detail = f"Complete · {', '.join(expected)} detected"
        assessed = True
        complete = True
    return {
        "assessed": assessed,
        "complete": complete,
        "source": source,
        "profile": MEDIA_STACK_PROFILE,
        "detected": [_provider_definition_label(provider) for provider in detected_ids],
        "detected_ids": list(detected_ids),
        "expected": expected,
        "expected_ids": list(expected_ids),
        "missing": missing,
        "missing_ids": list(missing_ids),
        "detail": detail,
    }


def _plex_request(path, params=None):
    query = dict(params or {})
    if PLEX_TOKEN:
        query["X-Plex-Token"] = PLEX_TOKEN
    query.setdefault("X-Plex-Product", "Homelab Control")
    query.setdefault("X-Plex-Version", "0.1.0")
    encoded = urlencode(query)
    url = f"{PLEX_BASE_URL}{path}{'?' + encoded if encoded else ''}"
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "HomelabControl/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            return json.load(response), None
    except urllib.error.HTTPError as exc:
        return None, "unauthorized" if exc.code in {401, 403} else f"http_{exc.code}"
    except (OSError, ValueError, urllib.error.URLError):
        return None, "unavailable"


def _plex_sessions(payload):
    container = payload.get("MediaContainer") if isinstance(payload, dict) else {}
    entries = container.get("Metadata", []) if isinstance(container, dict) else []
    output = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        player = entry.get("Player") if isinstance(entry.get("Player"), dict) else {}
        user = entry.get("User") if isinstance(entry.get("User"), dict) else {}
        title = entry.get("grandparentTitle") or entry.get("parentTitle") or entry.get("title") or "Unknown title"
        episode = entry.get("title") if entry.get("grandparentTitle") else None
        season = entry.get("parentIndex") if entry.get("grandparentTitle") else None
        index = entry.get("index") if entry.get("grandparentTitle") else None
        if episode and season is not None and index is not None:
            try:
                title = f"{title} — S{int(season):02d}E{int(index):02d} {episode}"
            except (TypeError, ValueError):
                title = f"{title} — {episode}"
        elif episode:
            title = f"{title} — {episode}"
        progress = None
        try:
            if entry.get("duration") and entry.get("viewOffset") is not None:
                progress = round(max(0, min(100, 100 * float(entry["viewOffset"]) / float(entry["duration"]))))
        except (TypeError, ValueError, ZeroDivisionError):
            pass
        mode = entry.get("videoResolution") or entry.get("type")
        transcode = entry.get("TranscodeSession") if isinstance(entry.get("TranscodeSession"), dict) else None
        if transcode:
            mode = "Transcoding"
        output.append({
            "title": title,
            "user": user.get("title") or "Unknown user",
            "device": player.get("title") or player.get("product") or "Unknown device",
            "state": "Paused" if entry.get("viewOffset") and entry.get("duration") and entry.get("viewOffset") == entry.get("duration") else "Playing",
            "progress_percent": progress,
            "play_method": mode,
            "stream_detail": " • ".join(str(value).upper() for value in (entry.get("videoCodec"), entry.get("audioCodec")) if value) or None,
        })
    return output


def _plex_libraries(payload):
    container = payload.get("MediaContainer") if isinstance(payload, dict) else {}
    entries = container.get("Directory", []) if isinstance(container, dict) else []
    output = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or not entry.get("title"):
            continue
        output.append({"title": str(entry.get("title"))[:100], "type": str(entry.get("type") or "library")[:40]})
    return output[:32]


def plex_summary():
    """Read optional Plex sessions and library names with a read-only token."""
    global _plex_cache_timestamp, _plex_cache_value
    if not PLEX_TOKEN:
        return {"enabled": False, "sessions": [], "libraries": [], "detail": "Plex read-only token is not configured"}
    now = time.monotonic()
    with _plex_cache_lock:
        if _plex_cache_value is not None and now - _plex_cache_timestamp < PLEX_CACHE_TTL:
            return json.loads(json.dumps(_plex_cache_value))
    sessions_payload, sessions_error = _plex_request("/status/sessions")
    libraries_payload, libraries_error = _plex_request("/library/sections")
    errors = [error for error in (sessions_error, libraries_error) if error]
    result = {
        "enabled": True,
        "sessions": _plex_sessions(sessions_payload) if sessions_payload else [],
        "libraries": _plex_libraries(libraries_payload) if libraries_payload else [],
        "detail": "; ".join(dict.fromkeys(errors)) if errors else None,
    }
    with _plex_cache_lock:
        _plex_cache_timestamp = time.monotonic()
        _plex_cache_value = result
    return json.loads(json.dumps(result))


def network_status():
    """Discover common DNS/network services without displaying absent options."""
    entries = containers()
    output = []
    for provider in _provider_rows(NETWORK_PROVIDER_DEFINITIONS, entries):
        started = time.monotonic()
        online = False
        error = None
        latency = None
        url = provider.get("url")
        state = provider.get("state")
        endpoint_probe = bool(url and (provider.get("configured") or provider.get("port_source") == "published"))
        try:
            if endpoint_probe:
                parsed = urlparse(url)
                port = parsed.port or (443 if parsed.scheme == "https" else 80)
                with socket.create_connection((parsed.hostname, port), timeout=2):
                    online = True
            elif provider.get("container") and state == "running":
                online = True
        except (OSError, ValueError) as exc:
            error = exc.__class__.__name__
            if provider.get("container") and state == "running" and provider.get("port_source") == "default" and not provider.get("configured"):
                online = True
                error = None
        if online and endpoint_probe:
            latency = round((time.monotonic() - started) * 1000)
        output.append({
            "id": provider["id"],
            "label": provider["label"],
            "container": provider.get("container"),
            "port": provider.get("port"),
            "online": online,
            "latency_ms": latency,
            "error": error,
            "state": state,
            "health_source": "tcp" if endpoint_probe else "docker",
            "probe_type": "TCP connect" if endpoint_probe else None,
            "detail": "endpoint reachable" if endpoint_probe and online else "container running; endpoint is internal or unpublished" if online else "endpoint unavailable",
        })
    return output


def network_summary(rows=None):
    """Describe explicitly required network providers without inventing any.

    Network stacks vary even more than media stacks: a homelab may use one
    Pi-hole, a Technitium pair, or only a VPN sidecar.  Therefore discovery is
    always shown on its own, while the complete/incomplete contract is only
    assessed when ``NETWORK_REQUIRED_PROVIDERS`` is configured.
    """
    rows = network_status() if rows is None else (rows if isinstance(rows, list) else [])
    detected_ids = tuple(dict.fromkeys(
        _normalise_provider_id(row.get("id"))
        for row in rows
        if isinstance(row, dict) and row.get("id")
    ))
    explicit = tuple(dict.fromkeys(
        _normalise_provider_id(value)
        for value in NETWORK_REQUIRED_PROVIDERS
        if value
    ))
    disabled = any(value in {"none", "off", "disabled"} for value in explicit)
    expected_ids = tuple(value for value in explicit if value not in {"none", "off", "disabled"})
    if disabled:
        source = "disabled"
        assessed = False
        complete = None
        expected_ids = ()
        missing_ids = ()
        detail = "Network-provider completeness checks are disabled"
    elif not expected_ids:
        source = "unconfigured"
        assessed = False
        complete = None
        missing_ids = ()
        detail = "No network-provider requirements are configured"
    else:
        source = "configured"
        missing_ids = tuple(provider for provider in expected_ids if provider not in detected_ids)
        assessed = True
        complete = not missing_ids
        detail = (
            f"Incomplete · missing {', '.join(_provider_definition_label(provider) for provider in missing_ids)}"
            if missing_ids
            else f"Complete · {', '.join(_provider_definition_label(provider) for provider in expected_ids)} detected"
        )
    expected = [_provider_definition_label(provider) for provider in expected_ids]
    missing = [_provider_definition_label(provider) for provider in missing_ids]
    return {
        "assessed": assessed,
        "complete": complete,
        "source": source,
        "detected": [_provider_definition_label(provider) for provider in detected_ids],
        "detected_ids": list(detected_ids),
        "expected": expected,
        "expected_ids": list(expected_ids),
        "missing": missing,
        "missing_ids": list(missing_ids),
        "detail": detail,
    }


def minecraft_status():
    """Discover Minecraft containers and attach a read-only resource sample.

    This is the dashboard-free fallback for homelabs that run Paper, Purpur,
    Fabric, Forge, Bedrock, or another server image directly in Docker.  A
    configured Crafty/Pterodactyl/Pelican panel remains the richer control
    surface, but the Docker fallback still shows real per-container CPU/RAM,
    process count and network counters.
    """
    entries = containers()
    policy = _policy_read()
    try:
        host_total = memory_stats()["total"]
    except (KeyError, OSError, ValueError):
        host_total = 0
    rows = []
    for entry in entries:
        if _container_category(entry) != "minecraft":
            continue
        state = str(entry.get("State") or "unknown")
        health, health_source = _container_health(entry)
        name = container_names(entry)[0] if container_names(entry) else str(entry.get("Id") or "container")[:12]
        row = {
            "id": _dynamic_service_key(entry),
            "label": _container_display_label(entry),
            "name": name,
            "container": name,
            "image": str(entry.get("Image") or "unknown")[:200],
            "state": state,
            "running": state == "running",
            "health": health,
            "health_source": health_source,
            "manageable": _control_allowed(entry, policy),
            "protected": _is_protected_container(entry),
            "backend": "docker",
            "detail": str(entry.get("Status") or ("container process alive" if state == "running" else f"container {state}"))[:220],
        }
        if state == "running":
            resource, error = _container_resources(entry, host_total)
            if resource:
                row["resources"] = resource
            elif error:
                row["resource_error"] = error[:180]
        rows.append(row)
    rows.sort(key=lambda item: (not item["running"], str(item["label"]).lower(), str(item["name"]).lower()))
    return {
        "available": True,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "detected": len(rows),
        "servers": rows,
        "detail": "Docker Minecraft containers discovered from the live catalogue",
    }


def _jellyfin_play_method(session):
    play_method = (session.get("PlayState") or {}).get("PlayMethod") or session.get("PlayMethod")
    if play_method == "DirectPlay":
        return "Direct play"
    if play_method == "DirectStream":
        return "Direct stream"
    if play_method in {"Transcode", "Transcoding"}:
        return "Transcoding"
    if session.get("TranscodingInfo"):
        return "Transcoding"
    return None


def _jellyfin_item_title(item):
    name = item.get("Name") or "Unknown title"
    series = item.get("SeriesName")
    if item.get("Type") == "Season" and series:
        return series
    season = item.get("ParentIndexNumber")
    episode = item.get("IndexNumber")
    if series and season is not None and episode is not None:
        try:
            return f"{series} — S{int(season):02d}E{int(episode):02d} {name}"
        except (TypeError, ValueError):
            pass
    if series:
        return f"{series} — {name}"
    return name


def _jellyfin_request(path, params=None):
    query = urlencode(params or {})
    url = f"{JELLYFIN_BASE_URL}{path}{'?' + query if query else ''}"
    request = urllib.request.Request(
        url,
        headers={
            "X-Emby-Token": JELLYFIN_API_KEY,
            "Accept": "application/json",
            "User-Agent": "HomelabControl/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            return json.load(response), None
    except urllib.error.HTTPError as exc:
        return None, "unauthorized" if exc.code in {401, 403} else f"http_{exc.code}"
    except (OSError, ValueError, urllib.error.URLError):
        return None, "unavailable"


def _jellyfin_session_details(session, item):
    streams = item.get("MediaStreams") if isinstance(item.get("MediaStreams"), list) else []
    video = next((stream for stream in streams if stream.get("Type") == "Video"), {})
    audio = next((stream for stream in streams if stream.get("Type") == "Audio"), {})
    resolution = None
    if video.get("Width") and video.get("Height"):
        resolution = f"{video['Width']}×{video['Height']}"
    transcode = session.get("TranscodingInfo") or {}
    bitrate = transcode.get("Bitrate") or item.get("Bitrate")
    bitrate_mbps = None
    try:
        if bitrate:
            bitrate_mbps = round(float(bitrate) / 1_000_000, 1)
    except (TypeError, ValueError):
        pass
    details = []
    if resolution:
        details.append(resolution)
    if video.get("Codec"):
        details.append(str(video["Codec"]).upper())
    if audio.get("Codec"):
        details.append(str(audio["Codec"]).upper())
    if bitrate_mbps is not None:
        details.append(f"{bitrate_mbps} Mbps")
    return " • ".join(details) or None


def _jellyfin_sessions(payload):
    sessions = []
    for session in payload if isinstance(payload, list) else []:
        if not isinstance(session, dict):
            continue
        item = session.get("NowPlayingItem") or {}
        if not item:
            continue
        play_state = session.get("PlayState") or {}
        user = session.get("User") if isinstance(session.get("User"), dict) else {}
        position_ticks = play_state.get("PositionTicks")
        runtime_ticks = item.get("RunTimeTicks")
        progress = None
        try:
            if runtime_ticks and position_ticks is not None:
                progress = round(max(0, min(100, 100 * float(position_ticks) / float(runtime_ticks))))
        except (TypeError, ValueError, ZeroDivisionError):
            progress = None
        sessions.append(
            {
                "user": session.get("UserName") or user.get("Name") or "Unknown user",
                "device": session.get("DeviceName") or session.get("Client") or "Unknown device",
                "title": _jellyfin_item_title(item),
                "state": "Paused" if play_state.get("IsPaused") else "Playing",
                "progress_percent": progress,
                "play_method": _jellyfin_play_method(session),
                "stream_detail": _jellyfin_session_details(session, item),
            }
        )
    return sessions


def _jellyfin_recent_items(payload):
    items = payload if isinstance(payload, list) else []
    output = []
    for item in items[:8]:
        if not isinstance(item, dict):
            continue
        output.append(
            {
                "title": _jellyfin_item_title(item),
                "type": item.get("Type") or "Media",
                "year": item.get("ProductionYear"),
                "season": item.get("IndexNumber") if item.get("Type") == "Season" else None,
            }
        )
    return output


def _jellyfin_library_counts(payload):
    if not isinstance(payload, dict):
        return {}
    labels = {
        "MovieCount": "Movies",
        "SeriesCount": "Series",
        "EpisodeCount": "Episodes",
        "SongCount": "Songs",
    }
    output = {}
    for source, label in labels.items():
        try:
            if payload.get(source) is not None:
                output[label] = int(payload[source])
        except (TypeError, ValueError):
            continue
    return output


def _jellyfin_alerts(payload):
    entries = payload.get("Items", []) if isinstance(payload, dict) else []
    output = []
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("Severity") not in {"Error", "Warning"}:
            continue
        output.append(
            {
                "severity": entry.get("Severity"),
                "name": entry.get("Name") or "Jellyfin alert",
                "detail": entry.get("ShortOverview") or entry.get("Overview") or "",
                "date": entry.get("Date"),
            }
        )
    return output[:5]


def _jellyfin_preferred_user_id():
    """Resolve a safe user scope for Jellyfin endpoints that require userId.

    Jellyfin's ``/Items/Latest`` endpoint returns HTTP 400 without a user
    scope on this installation.  An explicit JELLYFIN_USER_ID takes
    precedence; otherwise choose the first administrator, then the first
    enabled profile.  The ID is used only in the upstream request and is
    never returned by the agent.
    """
    if JELLYFIN_USER_ID:
        return JELLYFIN_USER_ID, None
    users, error = _jellyfin_request("/Users", {})
    if error:
        return None, error
    if not isinstance(users, list):
        return None, "user_scope_unavailable"
    enabled = [user for user in users if isinstance(user, dict) and (user.get("Policy") or {}).get("IsDisabled") is not True and user.get("Id")]
    if not enabled:
        return None, "user_scope_unavailable"
    administrator = next((user for user in enabled if (user.get("Policy") or {}).get("IsAdministrator") is True), None)
    selected = administrator or enabled[0]
    return str(selected.get("Id")), None


def jellyfin_summary():
    """Read Jellyfin playback and library summaries without exposing IPs or credentials."""
    global _jellyfin_cache_timestamp, _jellyfin_cache_value
    if not JELLYFIN_API_KEY:
        return {
            "enabled": False,
            "sessions": [],
            "recently_added": [],
            "library": {},
            "alerts": [],
            "detail": "Jellyfin read-only API key is not configured",
        }
    now = time.monotonic()
    with _jellyfin_cache_lock:
        if _jellyfin_cache_value is not None and now - _jellyfin_cache_timestamp < JELLYFIN_CACHE_TTL:
            return json.loads(json.dumps(_jellyfin_cache_value))

    latest_params = {
        "limit": 8,
        "fields": "DateCreated,ProductionYear,ParentIndexNumber,IndexNumber,MediaStreams,RunTimeTicks",
        # Season records make the recent list useful for shows: a grouped
        # Series record can repeat the same title without saying which season
        # was added. Movies remain first-class records in the same request.
        "includeItemTypes": "Movie,Season",
        "enableImages": "false",
        "groupItems": "true",
    }
    user_id, user_error = _jellyfin_preferred_user_id()
    if user_id:
        latest_params["userId"] = user_id
    requests = {
        "sessions": ("/Sessions", {"activeWithinSeconds": 900}),
        "recently_added": ("/Items/Latest", latest_params),
        "library": ("/Items/Counts", {}),
        "alerts": ("/System/ActivityLog/Entries", {"limit": 12, "hasUserId": "false"}),
    }
    responses = {}
    if not user_id:
        responses["recently_added"] = (None, user_error or "user_scope_unavailable")
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_jellyfin_request, path, params): key
            for key, (path, params) in requests.items()
            if key != "recently_added" or user_id
        }
        for future in as_completed(futures):
            key = futures[future]
            try:
                responses[key] = future.result()
            except Exception:
                responses[key] = (None, "unavailable")

    errors = [error for _, error in responses.values() if error]
    if "unauthorized" in errors:
        detail = "Jellyfin API key was rejected"
    elif len(errors) == len(requests):
        detail = "Jellyfin API is unavailable"
    elif errors:
        detail = "Some Jellyfin details are unavailable"
    else:
        detail = None
    result = {
        "enabled": True,
        "sessions": _jellyfin_sessions(responses.get("sessions", ([], None))[0]),
        "recently_added": _jellyfin_recent_items(responses.get("recently_added", ([], None))[0]),
        "library": _jellyfin_library_counts(responses.get("library", ({}, None))[0]),
        "alerts": _jellyfin_alerts(responses.get("alerts", ({}, None))[0]),
        "detail": detail,
    }
    with _jellyfin_cache_lock:
        _jellyfin_cache_timestamp = time.monotonic()
        _jellyfin_cache_value = result
    return json.loads(json.dumps(result))


def jellyfin_sessions():
    summary = jellyfin_summary()
    return {"enabled": summary["enabled"], "sessions": summary["sessions"], "detail": summary["detail"]}


def redact(text: str):
    for pattern in REDACTIONS:
        text = pattern.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]" if match.lastindex == 2 else "[REDACTED WEBHOOK]", text)
    return text


def decode_docker_logs(payload: bytes):
    if len(payload) < 8 or payload[0] not in (0, 1, 2):
        return payload.decode("utf-8", errors="replace")
    position = 0
    chunks = []
    while position + 8 <= len(payload):
        length = struct.unpack(">I", payload[position + 4 : position + 8])[0]
        start = position + 8
        end = start + length
        if end > len(payload):
            break
        chunks.append(payload[start:end])
        position = end
    return b"".join(chunks).decode("utf-8", errors="replace")


def service_logs(key: str, tail: int):
    definition, container = resolve_any_service(key)
    if not definition or not container:
        raise KeyError("Service not found")
    container_id = quote(container["Id"], safe="")
    path = f"/containers/{container_id}/logs?stdout=1&stderr=1&timestamps=1&tail={tail}"
    status, payload = docker_request("GET", path)
    if status != 200:
        raise RuntimeError(f"Docker logs returned HTTP {status}")
    lines = redact(decode_docker_logs(payload)).splitlines()
    return lines[-tail:]


def sanitize_audit_value(value: str | None, maximum=100):
    if not value:
        return "unknown"
    return re.sub(r"[^a-zA-Z0-9_.:@ -]", "?", value)[:maximum]


def append_audit(entry):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    entry = {"timestamp": datetime.now(timezone.utc).isoformat(), **entry}
    with (DATA_DIR / "audit.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, separators=(",", ":")) + "\n")


def recent_audit(limit=25):
    path = DATA_DIR / "audit.jsonl"
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]
    output = []
    for line in lines:
        try:
            output.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return output


def manage_service(key: str, action: str, actor_id: str, actor_name: str):
    if action not in {"start", "stop", "restart"}:
        raise ValueError("Unsupported action")
    definition, container = resolve_any_service(key)
    if not definition or not container:
        raise KeyError("Service not found")
    if not _control_allowed(container):
        if _is_protected_container(container):
            raise PermissionError("This container is protected from remote controls")
        raise PermissionError("Controls are disabled for this container; an administrator must enable it first")
    container_id = quote(container["Id"], safe="")
    suffix = "?t=30" if action in {"stop", "restart"} else ""
    status, payload = docker_request("POST", f"/containers/{container_id}/{action}{suffix}")
    ok = status in {204, 304}
    append_audit(
        {
            "actor_id": sanitize_audit_value(actor_id),
            "actor_name": sanitize_audit_value(actor_name),
            "action": action,
            "service": key,
            "result": "ok" if ok else f"docker_http_{status}",
        }
    )
    if not ok:
        message = payload.decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"Docker returned HTTP {status}: {message}")
    return {"ok": True, "service": key, "action": action, "label": definition["label"]}


def _read_env_file(path: Path):
    """Read only the small set of Runtipi values needed for its API.

    Runtipi keeps its generated environment in a host-owned .env file.  The
    controller receives that file read-only and deliberately extracts only
    the API address and JWT secret; it never returns the values to Discord.
    """
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return {}
    values = {}
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def _runtipi_config():
    file_values = _read_env_file(RUNTIPI_ENV_FILE)
    # Explicit container environment wins over the mounted host file.  This
    # lets a deployment override the address without copying or editing .env.
    jwt_secret = os.getenv("RUNTIPI_JWT_SECRET", "").strip() or file_values.get("JWT_SECRET", "").strip()
    api_url = RUNTIPI_API_URL
    if not api_url:
        host = os.getenv("RUNTIPI_INTERNAL_IP", "").strip() or file_values.get("INTERNAL_IP", "").strip() or HOST_GATEWAY
        port = os.getenv("RUNTIPI_NGINX_PORT", "").strip() or file_values.get("NGINX_PORT", "").strip() or "80"
        scheme = os.getenv("RUNTIPI_API_SCHEME", "http").strip() or "http"
        api_url = f"{scheme}://{host}:{port}/api"
    return {"api_url": api_url.rstrip("/"), "jwt_secret": jwt_secret}


def _base64url(value: bytes):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _runtipi_jwt(secret: str):
    now = int(time.time())
    header = _base64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode("utf-8"))
    payload = _base64url(json.dumps({"sub": "cli", "exp": now + 86400, "iat": now, "nbf": now}, separators=(",", ":")).encode("utf-8"))
    unsigned = f"{header}.{payload}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), unsigned, hashlib.sha256).digest()
    return f"{header}.{payload}.{_base64url(signature)}"


def _runtipi_request(path: str, method: str = "GET", body=None, timeout: float = 20):
    settings = _runtipi_config()
    if len(settings["jwt_secret"]) < 16:
        raise RuntimeError("Runtipi API credentials are unavailable")
    url = f"{settings['api_url']}/{path.lstrip('/')}"
    encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=encoded,
        method=method,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {_runtipi_jwt(settings['jwt_secret'])}",
            "Content-Type": "application/json",
            "User-Agent": "HomelabControl/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            if not raw:
                return {}
            try:
                return json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise RuntimeError("Runtipi returned an invalid response") from exc
    except urllib.error.HTTPError as exc:
        # Do not forward response bodies: Runtipi errors can contain internal
        # paths or configuration details that do not belong in Discord.
        raise RuntimeError(f"Runtipi API HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", None)
        raise RuntimeError(f"Runtipi API unavailable: {str(reason or exc)[:100]}") from exc
    except (TimeoutError, OSError) as exc:
        raise RuntimeError(f"Runtipi API unavailable: {exc.__class__.__name__}") from exc


def _app_id_from_urn(urn: str):
    value = str(urn or "").strip()
    parts = [part.strip() for part in value.split(":") if part.strip()]
    if len(parts) >= 2 and parts[-1].lower() in {"migrated", "_user"}:
        return parts[0]
    return parts[-1] if parts else ""


def _app_label(app_id: str):
    for key, definition in SERVICES.items():
        if key == app_id:
            return definition["label"]
    return app_id.replace("-", " ").replace("_", " ").title()


def _int_value(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _installed_app_updates(payload):
    """Validate Runtipi's installed-app response and normalise update rows."""
    installed = payload.get("installed") if isinstance(payload, dict) else None
    if not isinstance(installed, list):
        raise RuntimeError("Runtipi returned an unexpected installed-app list")
    updates = []
    protected = []
    for index, entry in enumerate(installed):
        if not isinstance(entry, dict):
            raise RuntimeError(f"Runtipi returned an invalid installed-app entry at index {index}")
        info = entry.get("info") if isinstance(entry.get("info"), dict) else None
        app = entry.get("app") if isinstance(entry.get("app"), dict) else None
        metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else None
        if info is None or not str(info.get("urn") or "").strip():
            raise RuntimeError(f"Runtipi installed-app entry {index} has no app ID")
        if not str(info.get("version") or "").strip():
            raise RuntimeError(f"Runtipi installed-app entry {index} has no current version")
        if app is None or _int_value(app.get("version")) is None:
            raise RuntimeError(f"Runtipi installed-app entry {index} has no Tipi version")
        if metadata is None or _int_value(metadata.get("latestVersion")) is None:
            raise RuntimeError(f"Runtipi installed-app entry {index} has no latest Tipi version")
        if not str(metadata.get("latestDockerVersion") or "").strip():
            raise RuntimeError(f"Runtipi installed-app entry {index} has no latest Docker version")
        app_id = _app_id_from_urn(info.get("urn"))
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,80}", app_id, re.IGNORECASE):
            raise RuntimeError(f"Runtipi returned an invalid app ID at index {index}")
        current_tipi = _int_value(app.get("version"))
        latest_tipi = _int_value(metadata.get("latestVersion"))
        if latest_tipi <= current_tipi:
            continue
        row = {
            "id": app_id,
            "label": _app_label(app_id),
            "urn": str(info.get("urn") or app_id),
            "current": str(info.get("version") or "unknown"),
            "latest": str(metadata.get("latestDockerVersion") or "unknown"),
            "tipi_current": current_tipi,
            "tipi_latest": latest_tipi,
            "protected": app_id.lower() in RUNTIPI_PROTECTED_APP_IDS,
        }
        (protected if row["protected"] else updates).append(row)
    return updates, protected, len(installed)


def runtipi_updates(force=False):
    """Return eligible app updates without changing any host state."""
    global _runtipi_cache_timestamp, _runtipi_cache_value
    now = time.monotonic()
    with _runtipi_cache_lock:
        if not force and _runtipi_cache_value is not None and now - _runtipi_cache_timestamp < 60:
            return json.loads(json.dumps(_runtipi_cache_value))
    try:
        payload = _runtipi_request("apps/installed")
        updates, protected, installed_total = _installed_app_updates(payload)
        result = {
            "available": True,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "installed_total": installed_total,
            "updates": updates,
            "protected_updates": protected,
            "detail": "Updates are checked through the supported Runtipi API",
        }
    except Exception as exc:
        result = {
            "available": False,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "installed_total": 0,
            "updates": [],
            "protected_updates": [],
            "detail": str(exc)[:160],
        }
    with _runtipi_cache_lock:
        _runtipi_cache_timestamp = time.monotonic()
        _runtipi_cache_value = result
    return json.loads(json.dumps(result))


_RELEASE_RE = re.compile(r"^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")
_REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]{1,39}/[A-Za-z0-9_.-]{1,100}$")
_SHA256_RE = re.compile(r"^sha256:[0-9a-fA-F]{64}$")


def _release_version(value):
    """Return a normalised semantic version or None for an unsafe tag."""
    match = _RELEASE_RE.fullmatch(str(value or "").strip())
    if not match:
        return None
    major, minor, patch, prerelease = match.groups()
    return f"{major}.{minor}.{patch}{f'-{prerelease}' if prerelease else ''}"


def _release_version_key(value):
    """Return a comparison key where stable releases beat pre-releases."""
    normalised = _release_version(value)
    if not normalised:
        return None
    base, _, prerelease = normalised.partition("-")
    numbers = tuple(int(part) for part in base.split("."))
    # Stable releases are newer than a pre-release of the same version.  The
    # exact ordering between two pre-release identifiers is deliberately not
    # used because the stable channel never advertises them.
    return (*numbers, 1 if not prerelease else 0, prerelease or "")


def _github_release_payload(repository):
    if not _REPOSITORY_RE.fullmatch(repository):
        raise ValueError("GitHub repository must use owner/repository form")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/releases/latest",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "Homelab-Control-release-check",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=BOT_RELEASE_TIMEOUT) as response:
        status = getattr(response, "status", 200)
        if status != 200:
            raise RuntimeError(f"GitHub returned HTTP {status}")
        body = response.read(2 * 1024 * 1024 + 1)
    if len(body) > 2 * 1024 * 1024:
        raise RuntimeError("GitHub release metadata is too large")
    payload = json.loads(body.decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("GitHub returned an unexpected release response")
    return payload


def _github_releases_payload(repository):
    """Return a bounded list of public releases for safe rollback discovery."""
    if not _REPOSITORY_RE.fullmatch(repository):
        raise ValueError("GitHub repository must use owner/repository form")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/releases?per_page=30",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "Homelab-Control-release-check",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=BOT_RELEASE_TIMEOUT) as response:
        status = getattr(response, "status", 200)
        if status != 200:
            raise RuntimeError(f"GitHub returned HTTP {status}")
        body = response.read(4 * 1024 * 1024 + 1)
    if len(body) > 4 * 1024 * 1024:
        raise RuntimeError("GitHub release metadata is too large")
    payload = json.loads(body.decode("utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError("GitHub returned an unexpected release list")
    return [entry for entry in payload if isinstance(entry, dict)]


def _github_previous_release(repository, current):
    """Find the highest earlier stable release with one verified archive."""
    current_key = _release_version_key(current)
    if not current_key:
        return None, "The installed bot version is not a safe semantic version"
    releases = _github_releases_payload(repository)
    candidates = []
    for release in releases:
        if release.get("draft"):
            continue
        if HOMELAB_CONTROL_RELEASE_CHANNEL == "stable" and release.get("prerelease"):
            continue
        version = _release_version(release.get("tag_name"))
        version_key = _release_version_key(version)
        if not version or not version_key or version_key >= current_key:
            continue
        asset, detail = _release_archive_asset(release)
        if not asset or not asset.get("digest"):
            continue
        candidates.append((version_key, {
            "version": version,
            "tag": str(release.get("tag_name") or "")[:120],
            "release_url": str(release.get("html_url") or "")[:500],
            "published_at": str(release.get("published_at") or "")[:80],
            "asset_name": asset.get("name"),
            "asset_url": asset.get("url"),
            "asset_digest": asset.get("digest"),
        }))
    if not candidates:
        return None, "No earlier GitHub release with a verified source archive was found"
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1], None


def _github_rollback_fields(repository, current, local_available=False, local_version=None):
    """Build rollback fields without coupling them to the latest-release check."""
    try:
        previous, detail = _github_previous_release(repository, current)
    except (OSError, urllib.error.URLError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        previous, detail = None, f"Previous GitHub releases could not be checked ({exc.__class__.__name__})"
    return {
        "rollback_available": bool(local_available or previous),
        "rollback_source": "local" if local_available else "github" if previous else None,
        "rollback_version": local_version if local_available else previous.get("version") if previous else None,
        "github_rollback_available": bool(previous),
        "github_rollback_version": previous.get("version") if previous else None,
        "github_rollback": previous,
        "rollback_detail": detail,
        "github_rollback_detail": detail,
    }


def _release_archive_asset(payload):
    assets = payload.get("assets") if isinstance(payload.get("assets"), list) else []
    candidates = []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        name = str(asset.get("name") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,160}\.(?:tar\.gz|tgz)", name, re.IGNORECASE):
            continue
        if HOMELAB_CONTROL_RELEASE_ASSET and name != HOMELAB_CONTROL_RELEASE_ASSET:
            continue
        candidates.append(asset)
    if len(candidates) != 1:
        if not candidates:
            return None, "The release has no configured source archive asset"
        return None, "The release has more than one possible source archive; set HOMELAB_CONTROL_RELEASE_ASSET"
    asset = candidates[0]
    digest = str(asset.get("digest") or "").strip().lower()
    if not _SHA256_RE.fullmatch(digest):
        return {"name": str(asset.get("name") or "")[:180], "url": str(asset.get("browser_download_url") or "")[:500], "digest": None}, "GitHub did not provide a SHA-256 asset digest; update is blocked until the release is rebuilt with a checksum"
    url = str(asset.get("browser_download_url") or "").strip()
    if not url.startswith("https://github.com/"):
        return None, "The release archive URL is not a GitHub download URL"
    return {"name": str(asset.get("name") or "")[:180], "url": url[:500], "digest": digest}, None


def _safe_bot_release_state():
    raw = _read_json_file(BOT_RELEASE_STATUS_FILE)
    safe = {}
    for key in ("phase", "job_id", "updated_at", "started_at", "completed_at", "requested_version", "current_version", "previous_version", "rollback_source", "detail"):
        if raw.get(key) is None:
            continue
        safe[key] = redact(str(raw.get(key)))[:240] if key == "detail" else str(raw.get(key))[:160]
    safe["rollback_available"] = bool(raw.get("rollback_available"))
    safe["update_supported"] = bool(raw.get("update_supported"))
    events = []
    for event in raw.get("events", []) if isinstance(raw.get("events"), list) else []:
        if isinstance(event, dict) and event.get("message"):
            events.append({"at": str(event.get("at") or "")[:80], "message": redact(str(event.get("message")))[:220]})
    safe["events"] = events[-8:]
    return safe


def bot_release_status(force=False):
    """Check the configured public GitHub release without changing the host."""
    global _bot_release_cache_timestamp, _bot_release_cache_value
    state = _safe_bot_release_state()
    repository = HOMELAB_CONTROL_REPOSITORY
    state_current = state.get("current_version")
    installed_version = state_current if state.get("phase") in {"complete", "rolled_back"} and _release_version(state_current) else HOMELAB_CONTROL_VERSION
    base = {
        "available": True,
        "configured": bool(repository),
        "repository": repository[:140],
        "channel": HOMELAB_CONTROL_RELEASE_CHANNEL,
        "current": _release_version(installed_version) or str(installed_version)[:80],
        "latest": None,
        "update_available": False,
        "asset_verified": False,
        "update_supported": bool(state.get("update_supported")),
        "rollback_available": bool(state.get("rollback_available")),
        "rollback_version": state.get("previous_version"),
        "rollback_source": state.get("rollback_source") or ("local" if state.get("rollback_available") else None),
        "github_rollback_available": False,
        "github_rollback_version": None,
        "github_rollback": None,
        "phase": state.get("phase", "idle"),
        "job_id": state.get("job_id"),
        "requested_version": state.get("requested_version"),
        "events": state.get("events", []),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    if not repository:
        base["detail"] = "Set HOMELAB_CONTROL_REPOSITORY to enable bot release checks"
        return base
    if not _REPOSITORY_RE.fullmatch(repository):
        base["configured"] = False
        base["detail"] = "HOMELAB_CONTROL_REPOSITORY must use owner/repository form"
        return base
    now = time.monotonic()
    with _bot_release_cache_lock:
        if not force and _bot_release_cache_value is not None and now - _bot_release_cache_timestamp < BOT_RELEASE_CACHE_TTL:
            cached = json.loads(json.dumps(_bot_release_cache_value))
            cached.update({key: value for key, value in base.items() if key in {"phase", "job_id", "requested_version", "events", "rollback_available", "rollback_version", "rollback_source", "update_supported"}})
            return cached
    try:
        payload = _github_release_payload(repository)
        tag = str(payload.get("tag_name") or "").strip()
        latest = _release_version(tag)
        if not latest:
            raise RuntimeError("GitHub latest release has no safe semantic version tag")
        if HOMELAB_CONTROL_RELEASE_CHANNEL == "stable" and bool(payload.get("prerelease")):
            raise RuntimeError("The latest GitHub release is a pre-release and stable channel is enabled")
        asset, asset_detail = _release_archive_asset(payload)
        current_key = _release_version_key(base["current"])
        latest_key = _release_version_key(latest)
        update_available = bool(current_key and latest_key and latest_key > current_key)
        local_rollback = bool(base.get("rollback_available"))
        rollback_fields = _github_rollback_fields(repository, base["current"], local_rollback, base.get("rollback_version"))
        result = {
            **base,
            "latest": latest,
            "tag": tag[:120],
            "update_available": update_available,
            "asset_verified": bool(asset and asset.get("digest")),
            "release_url": str(payload.get("html_url") or "")[:500],
            "published_at": str(payload.get("published_at") or "")[:80],
            "asset_name": asset.get("name") if asset else None,
            "asset_url": asset.get("url") if asset else None,
            "asset_digest": asset.get("digest") if asset else None,
            **rollback_fields,
            "detail": asset_detail or ("A newer verified release is ready" if update_available else "This installation is on the latest stable release"),
        }
    except (OSError, urllib.error.URLError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        rollback_fields = _github_rollback_fields(repository, base["current"], bool(base.get("rollback_available")), base.get("rollback_version"))
        result = {**base, "available": False, **rollback_fields, "detail": str(exc)[:240]}
    with _bot_release_cache_lock:
        _bot_release_cache_timestamp = time.monotonic()
        _bot_release_cache_value = result
    return json.loads(json.dumps(result))


def updates_status(force=False):
    """Return Runtipi and Homelab Control release status independently."""
    snapshot = runtipi_updates(force=force)
    snapshot["bot"] = bot_release_status(force=force)
    return snapshot


def _container_matches_app(container, app_id: str):
    wanted = re.sub(r"[^a-z0-9]", "", app_id.lower())
    if not wanted:
        return False
    names = container_names(container)
    labels = container.get("Labels") if isinstance(container.get("Labels"), dict) else {}
    candidates = names + [str(value) for value in labels.values()]
    return any(wanted in re.sub(r"[^a-z0-9]", "", value.lower()) for value in candidates)


def resolve_app_container(app_id: str, entries=None):
    entries = entries if entries is not None else containers()
    candidates = [entry for entry in entries if _container_matches_app(entry, app_id)]
    if not candidates:
        return None
    # Prefer the running container and then a name containing the app ID.  A
    # Runtipi app can have more than one service; checking any running service
    # is safer than claiming a stopped app is healthy.
    candidates.sort(key=lambda entry: (entry.get("State") == "running", app_id.lower() in " ".join(container_names(entry)).lower()), reverse=True)
    return candidates[0]


def _container_inspect(container_id: str):
    status, payload = docker_request("GET", f"/containers/{quote(container_id, safe='')}/json")
    if status != 200:
        raise RuntimeError(f"Docker returned HTTP {status}")
    return json.loads(payload.decode("utf-8"))


def _published_tcp_port_pairs(inspected):
    ports = ((inspected.get("NetworkSettings") or {}).get("Ports") or {})
    values = []
    for container_port, bindings in ports.items():
        if not str(container_port).lower().endswith("/tcp"):
            continue
        if not bindings:
            continue
        try:
            private_port = int(str(container_port).split("/", 1)[0])
        except (TypeError, ValueError):
            continue
        for binding in bindings:
            try:
                values.append((int(binding.get("HostPort")), private_port))
            except (AttributeError, TypeError, ValueError):
                continue
    return sorted(set(values))


def _published_tcp_ports(inspected):
    return [host for host, _private in _published_tcp_port_pairs(inspected)]


def _tcp_probe(port: int):
    started = time.monotonic()
    try:
        with socket.create_connection((HOST_GATEWAY, port), timeout=2):
            return {"ok": True, "detail": f"TCP {port} • {round((time.monotonic() - started) * 1000)} ms"}
    except OSError as exc:
        return {"ok": False, "detail": f"TCP {port} • {exc.__class__.__name__}"}


def verify_app_container(app_id: str):
    """Verify the Docker container and, where possible, its published port."""
    candidate = resolve_app_container(app_id)
    if not candidate:
        return {"ok": False, "state": "missing", "detail": "No Docker container matched this Runtipi app"}
    name = container_names(candidate)[0] if container_names(candidate) else candidate.get("Id", "")[:12]
    try:
        inspected = _container_inspect(candidate.get("Id") or name)
    except Exception as exc:
        return {"ok": False, "container": name, "state": "unknown", "detail": str(exc)[:120]}
    state = inspected.get("State") or {}
    if not state.get("Running"):
        return {"ok": False, "container": name, "state": state.get("Status", "stopped"), "detail": "Docker container is not running"}
    health = (state.get("Health") or {}).get("Status")
    if health in {"unhealthy", "starting"}:
        return {"ok": False, "container": name, "state": "running", "health": health, "detail": f"Docker health is {health}"}
    port_pairs = _published_tcp_port_pairs(inspected)
    ports = [host for host, _private in port_pairs]
    probe = None
    verified_port = None
    # Known host-network services must be checked at the process/container
    # boundary because their listener is intentionally not on this bridge.
    known = SERVICE_PROBES.get(app_id)
    if known and known.get("host_network"):
        # Host-network services cannot be reached through the agent bridge;
        # Docker's running/health state is the honest verification boundary.
        probe_ok = True
    elif known:
        expected = int(known.get("port"))
        matching = [host for host, private in port_pairs if host == expected or private == expected]
        if len(matching) == 1:
            verified_port = matching[0]
            probe = http_probe({**known, "port": matching[0]})
            probe_ok = probe.get("health") == "healthy"
        elif len(port_pairs) == 1:
            verified_port = port_pairs[0][0]
            probe = http_probe({**known, "port": port_pairs[0][0]})
            probe_ok = probe.get("health") == "healthy"
        elif not port_pairs:
            probe_ok = True
        else:
            probe = {"ok": False, "detail": "Published ports are ambiguous; no app ping was attempted"}
            probe_ok = False
    elif len(port_pairs) == 1:
        verified_port = port_pairs[0][0]
        probe = _tcp_probe(port_pairs[0][0])
        probe_ok = probe.get("ok") is True
    elif not port_pairs:
        probe_ok = True
    else:
        probe = {"ok": False, "detail": "Published ports are ambiguous; no app ping was attempted"}
        probe_ok = False
    reported_port = verified_port if probe_ok else None
    detail = f"Docker running{f' • health {health}' if health else ''}"
    if probe:
        detail = f"{detail} • {probe.get('health_detail') or probe.get('detail', '')}"
    return {
        "ok": bool(probe_ok),
        "container": name,
        "state": "running",
        "health": health or "running",
        "port": reported_port,
        "detail": detail,
    }


def _find_update(updates, app_id):
    return next((row for row in updates if row["id"].lower() == app_id.lower()), None)


def _wait_for_updated_app(app_id: str, target_tipi: int, timeout: float):
    deadline = time.monotonic() + timeout
    last_version = None
    last_probe = None
    while time.monotonic() < deadline:
        try:
            installed = _runtipi_request("apps/installed", timeout=15)
            updates, _, _ = _installed_app_updates(installed)
            entry = next((item for item in installed.get("installed", []) if isinstance(item, dict) and _app_id_from_urn((item.get("info") or {}).get("urn")).lower() == app_id.lower()), None)
            if isinstance(entry, dict):
                last_version = _int_value((entry.get("app") or {}).get("version"))
            last_probe = verify_app_container(app_id)
            version_done = last_version is not None and last_version >= target_tipi
            if version_done and last_probe.get("ok"):
                return {"ok": True, "version": last_version, "verification": last_probe}
            # If Runtipi no longer reports this app as behind, its metadata has
            # converged even when the numeric version is not exposed exactly.
            still_pending = _find_update(updates, app_id) is not None
            if not still_pending and last_probe.get("ok"):
                return {"ok": True, "version": last_version, "verification": last_probe}
        except Exception as exc:
            last_probe = {"ok": False, "detail": str(exc)[:120]}
        time.sleep(RUNTIPI_POLL_INTERVAL)
    return {"ok": False, "version": last_version, "verification": last_probe or {"ok": False, "detail": "No Docker response yet"}, "detail": "Timed out waiting for the updated version and Docker ping"}


def _update_one_locked(row: dict, actor_id: str, actor_name: str):
    app_id = row["id"]
    candidate = resolve_app_container(app_id)
    if not candidate:
        result = {**row, "status": "skipped", "verified": False, "detail": "No matching Docker container; nothing was changed"}
        return result
    if candidate.get("State") != "running":
        result = {**row, "status": "skipped", "verified": False, "container": container_names(candidate)[0] if container_names(candidate) else "unknown", "detail": "Container is stopped; start it first so the post-update ping can be verified"}
        return result
    started = time.monotonic()
    try:
        # The installed-app catalogue returns a namespaced URN (for example
        # ``filebrowser:migrated``).  Runtipi's lifecycle endpoint requires
        # that exact namespace; the short display ID is only for lookups and
        # container verification.
        lifecycle_id = str(row.get("urn") or "").strip()
        if not lifecycle_id:
            raise RuntimeError("Runtipi update row has no namespaced app ID")
        response = _runtipi_request(f"app-lifecycle/{quote(lifecycle_id, safe='')}/update", method="PATCH", body={"performBackup": True}, timeout=30)
        request_id = response.get("requestId") if isinstance(response, dict) else None
        verification = _wait_for_updated_app(app_id, row["tipi_latest"], RUNTIPI_UPDATE_TIMEOUT)
        result = {
            **row,
            "status": "updated" if verification.get("ok") else "failed",
            "verified": bool(verification.get("ok")),
            "container": verification.get("verification", {}).get("container"),
            "verification": verification.get("verification"),
            "request_id": str(request_id)[:80] if request_id else None,
            "duration_seconds": round(time.monotonic() - started, 1),
        }
        if not verification.get("ok"):
            result["detail"] = verification.get("detail", "Docker verification did not succeed")
        return result
    except Exception as exc:
        return {**row, "status": "failed", "verified": False, "detail": str(exc)[:180], "duration_seconds": round(time.monotonic() - started, 1)}


def update_app(app_id: str, actor_id: str, actor_name: str):
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,80}", app_id or "", re.IGNORECASE):
        raise ValueError("Invalid Runtipi app ID")
    if app_id.lower() in RUNTIPI_PROTECTED_APP_IDS:
        raise PermissionError("This control app is protected from Discord updates")
    if not _runtipi_update_lock.acquire(blocking=False):
        return {"status": "busy", "verified": False, "detail": "Another Runtipi update is already in progress"}
    try:
        snapshot = runtipi_updates(force=True)
        if not snapshot.get("available"):
            return {"status": "failed", "verified": False, "detail": snapshot.get("detail", "Runtipi update check unavailable")}
        row = _find_update(snapshot.get("updates", []), app_id)
        if not row:
            return {"status": "current", "verified": True, "id": app_id, "label": _app_label(app_id), "detail": "No eligible update is currently available"}
        result = _update_one_locked(row, actor_id, actor_name)
        append_audit({"actor_id": sanitize_audit_value(actor_id), "actor_name": sanitize_audit_value(actor_name), "action": "update", "service": app_id, "result": result.get("status", "unknown")})
        with _runtipi_cache_lock:
            _runtipi_cache_timestamp = 0
        return result
    finally:
        _runtipi_update_lock.release()


def update_all(actor_id: str, actor_name: str):
    if not _runtipi_update_lock.acquire(blocking=False):
        return {"status": "busy", "verified": False, "results": [], "detail": "Another Runtipi update is already in progress"}
    try:
        snapshot = runtipi_updates(force=True)
        if not snapshot.get("available"):
            return {"status": "failed", "verified": False, "results": [], "detail": snapshot.get("detail", "Runtipi update check unavailable")}
        results = []
        deadline = time.monotonic() + RUNTIPI_UPDATE_ALL_TIMEOUT
        for row in snapshot.get("updates", []):
            if time.monotonic() >= deadline:
                results.append({
                    **row,
                    "status": "skipped",
                    "verified": False,
                    "detail": "Not attempted: update-all safety time budget reached",
                })
                continue
            result = _update_one_locked(row, actor_id, actor_name)
            results.append(result)
            append_audit({"actor_id": sanitize_audit_value(actor_id), "actor_name": sanitize_audit_value(actor_name), "action": "update", "service": row["id"], "result": result.get("status", "unknown")})
        successful = sum(1 for result in results if result.get("status") == "updated" and result.get("verified"))
        failed = sum(1 for result in results if result.get("status") == "failed")
        skipped = sum(1 for result in results if result.get("status") == "skipped")
        status = "updated" if not failed and not skipped else "attention"
        with _runtipi_cache_lock:
            _runtipi_cache_timestamp = 0
        return {
            "status": status,
            "verified": not failed and not skipped,
            "results": results,
            "successful": successful,
            "failed": failed,
            "skipped": skipped,
            "attempted": len(results) - skipped,
            "time_budget_seconds": RUNTIPI_UPDATE_ALL_TIMEOUT,
            "protected_updates": snapshot.get("protected_updates", []),
        }
    finally:
        _runtipi_update_lock.release()


def _read_json_file(path: Path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _update_notifier_snapshot():
    """Parse the host's read-only update summary without exposing host output."""
    os_info = host_os()
    path = HOST_UPDATE_NOTIFIER_DIR / "updates-available"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {
            "available": False,
            "os": os_info,
            "update_supported": os_info["id"] in HOST_UPDATE_SUPPORTED_OS_IDS,
            "detail": f"{os_info['pretty_name']} update status is not mounted",
        }
    pending = None
    security = None
    match = re.search(r"(\d+)\s+updates? can be applied", text, re.IGNORECASE)
    if match:
        pending = int(match.group(1))
    match = re.search(r"(\d+)\s+of these updates? are standard security updates", text, re.IGNORECASE)
    if match:
        security = int(match.group(1))
    esm_disabled = "expanded security maintenance for applications is not enabled" in text.lower()
    return {
        "available": True,
        "os": os_info,
        "update_supported": os_info["id"] in HOST_UPDATE_SUPPORTED_OS_IDS,
        "pending_count": pending,
        "security_count": security,
        "esm_enabled": not esm_disabled,
        "notice": "ESM Apps is not enabled" if esm_disabled else None,
    }


def _safe_maintenance_status():
    """Return only the bounded, sanitised fields written by the root bridge."""
    raw = _read_json_file(SYSTEM_STATUS_FILE)
    safe = {}
    for key in ("phase", "job_id", "started_at", "completed_at", "updated_at", "checked_at", "online_at", "reboot_requested_at", "boot_id", "detail"):
        value = raw.get(key)
        if value is None:
            continue
        if key == "detail":
            safe[key] = redact(str(value))[:240]
        else:
            safe[key] = str(value)[:160]
    safe["phase"] = safe.get("phase", "idle")
    safe["reboot_required"] = bool(raw.get("reboot_required"))
    events = []
    for event in raw.get("events", []) if isinstance(raw.get("events"), list) else []:
        if not isinstance(event, dict):
            continue
        message = redact(str(event.get("message") or "")).replace("\r", " ").replace("\n", " ").strip()
        if not message:
            continue
        events.append({"at": str(event.get("at") or "")[:80], "message": message[:220]})
    safe["events"] = events[-8:]
    packages = []
    for package in raw.get("packages", []) if isinstance(raw.get("packages"), list) else []:
        if not isinstance(package, dict) or not package.get("name"):
            continue
        packages.append({
            "name": re.sub(r"[^a-zA-Z0-9+._:-]", "", str(package.get("name")))[:100],
            "latest": re.sub(r"[^a-zA-Z0-9+._:~-]", "", str(package.get("latest") or "unknown"))[:120],
            "origin": redact(str(package.get("origin") or "unknown"))[:120],
            "security": bool(package.get("security")),
        })
    safe["packages"] = packages[:50]
    for key in ("available", "pending_count", "security_count", "security_detail", "deferred_count", "esm_enabled", "notice"):
        if key in raw:
            safe[key] = redact(str(raw[key]))[:240] if key == "security_detail" else raw[key]
    if isinstance(raw.get("os"), dict):
        os_value = raw["os"]
        safe["os"] = {
            "id": re.sub(r"[^a-z0-9._+-]", "", str(os_value.get("id") or "unknown").lower())[:40] or "unknown",
            "name": re.sub(r"[\r\n]+", " ", str(os_value.get("name") or "Unknown OS"))[:80],
            "pretty_name": re.sub(r"[\r\n]+", " ", str(os_value.get("pretty_name") or os_value.get("name") or "Unknown OS"))[:120],
            "version_id": re.sub(r"[^a-zA-Z0-9._+-]", "", str(os_value.get("version_id") or ""))[:40],
            "source": str(os_value.get("source") or "bridge")[:30],
        }
    for key in ("update_supported", "package_manager"):
        if key in raw:
            safe[key] = bool(raw[key]) if key == "update_supported" else re.sub(r"[^a-zA-Z0-9._+-]", "", str(raw[key]))[:40]
    for key in ("security_packages", "standard_packages", "deferred_packages"):
        values = raw.get(key)
        if isinstance(values, list):
            safe[key] = [re.sub(r"[^a-zA-Z0-9+._:-]", "", str(value))[:100] for value in values[:100] if value]
    return safe


def system_updates():
    """Read host update status and maintenance progress; never runs a package manager."""
    os_info = host_os()
    notifier = _update_notifier_snapshot()
    status = _safe_maintenance_status()
    packages = status.get("packages") or []
    pending = status.get("pending_count")
    if packages:
        pending = len(packages)
    elif pending is not None:
        try:
            pending = max(0, int(pending))
        except (TypeError, ValueError):
            pending = None
    result = {
        "available": bool(status.get("available", notifier.get("available", False))),
        "os": status.get("os") or notifier.get("os") or os_info,
        "update_supported": bool(status.get("update_supported", notifier.get("update_supported", os_info["id"] in HOST_UPDATE_SUPPORTED_OS_IDS))),
        "checked_at": status.get("checked_at") or datetime.now(timezone.utc).isoformat(),
        "pending_count": pending if pending is not None else notifier.get("pending_count"),
        "security_count": status.get("security_count", notifier.get("security_count")),
        "security_detail": status.get("security_detail"),
        "security_packages": status.get("security_packages", []),
        "standard_packages": status.get("standard_packages", []),
        "deferred_packages": status.get("deferred_packages", []),
        "deferred_count": status.get("deferred_count", 0),
        "esm_enabled": status.get("esm_enabled", notifier.get("esm_enabled")),
        "notice": status.get("notice", notifier.get("notice")),
        "packages": packages,
        "phase": status.get("phase", "idle"),
        "job_id": status.get("job_id"),
        "boot_id": status.get("boot_id"),
        "reboot_required": bool(status.get("reboot_required")),
        "events": status.get("events", []),
        "detail": status.get("detail") or notifier.get("detail"),
        "maintenance_available": MAINTENANCE_DIR.is_dir() and os.access(MAINTENANCE_DIR, os.W_OK),
    }
    # The bridge is authoritative once it has written a status snapshot.  If
    # it has not been installed yet, the read-only notifier file still gives a
    # useful status but no action buttons are exposed.
    if status:
        result["available"] = bool(status.get("available", result["available"]))
        result["checked_at"] = status.get("checked_at", result["checked_at"])
    return result


def _write_maintenance_request(request: dict):
    temporary = SYSTEM_REQUEST_FILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(request, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, SYSTEM_REQUEST_FILE)


def _queue_system_request(action: str, actor_id: str, actor_name: str, job_id: str | None = None):
    if action not in {"apply_updates", "reboot"}:
        raise ValueError("Unsupported maintenance action")
    if not MAINTENANCE_DIR.is_dir() or not os.access(MAINTENANCE_DIR, os.W_OK):
        raise RuntimeError("The guarded host maintenance bridge is not installed")
    existing_request = _read_json_file(SYSTEM_REQUEST_FILE)
    if existing_request:
        raise RuntimeError("Another host maintenance request is already queued")
    snapshot = system_updates()
    if not snapshot.get("update_supported", True):
        os_name = (snapshot.get("os") or {}).get("pretty_name") or (snapshot.get("os") or {}).get("name") or "This operating system"
        raise RuntimeError(f"{os_name} is detected, but the installed host bridge does not support package updates for it")
    phase = snapshot.get("phase", "idle")
    if action == "apply_updates":
        if phase in {"checking", "applying", "rebooting"}:
            raise RuntimeError("Host maintenance is already in progress")
        if phase == "ready_for_reboot":
            raise RuntimeError("Host updates are applied and are waiting for a confirmed restart")
        pending = snapshot.get("pending_count")
        if pending is None or int(pending) <= 0:
            raise RuntimeError("No pending host updates were confirmed")
        selected_job_id = uuid.uuid4().hex[:24]
    else:
        selected_job_id = str(job_id or "")[:80]
        if phase != "ready_for_reboot" or not snapshot.get("reboot_required"):
            raise RuntimeError("The host is not waiting for a confirmed restart")
        if not selected_job_id or not hmac.compare_digest(selected_job_id, str(snapshot.get("job_id") or "")):
            raise RuntimeError("The restart confirmation does not match the current update job")
    request = {
        "schema": 1,
        "action": action,
        "job_id": selected_job_id,
        "actor_id": sanitize_audit_value(actor_id),
        "actor_name": sanitize_audit_value(actor_name),
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        _write_maintenance_request(request)
    except OSError as exc:
        raise RuntimeError("The maintenance request could not be queued") from exc
    return {
        "accepted": True,
        "job_id": selected_job_id,
        "phase": "queued",
        "detail": "Host updates queued; no restart will occur automatically" if action == "apply_updates" else "Restart queued after explicit confirmation",
    }


def _queue_bot_release_request(action: str, actor_id: str, actor_name: str):
    """Queue one guarded bot release action for the root-owned host bridge."""
    if action not in {"bot_update", "bot_rollback"}:
        raise ValueError("Unsupported bot release action")
    if not MAINTENANCE_DIR.is_dir() or not os.access(MAINTENANCE_DIR, os.W_OK):
        raise RuntimeError("The guarded bot release bridge is not installed")
    if _read_json_file(SYSTEM_REQUEST_FILE):
        raise RuntimeError("Another host maintenance request is already queued")
    snapshot = bot_release_status(force=True)
    if snapshot.get("phase") in {"queued", "checking", "downloading", "verifying", "staging", "building", "restarting", "verifying_runtime"}:
        raise RuntimeError("A bot release action is already in progress")
    if action == "bot_update":
        if not snapshot.get("configured"):
            raise RuntimeError(snapshot.get("detail", "Configure a GitHub repository before updating the bot"))
        if not snapshot.get("update_available"):
            raise RuntimeError("No newer stable bot release is available")
        if not snapshot.get("asset_verified"):
            raise RuntimeError(snapshot.get("detail", "The release archive has no verified SHA-256 digest"))
        if not snapshot.get("update_supported"):
            raise RuntimeError("The host release bridge is installed but its Compose deployment target is not configured")
        selected_version = str(snapshot.get("latest") or "")
        request = {
            "schema": 1,
            "action": action,
            "job_id": uuid.uuid4().hex[:24],
            "repository": snapshot.get("repository"),
            "tag": snapshot.get("tag"),
            "version": selected_version,
            "asset_name": snapshot.get("asset_name"),
            "asset_url": snapshot.get("asset_url"),
            "asset_digest": snapshot.get("asset_digest"),
            "actor_id": sanitize_audit_value(actor_id),
            "actor_name": sanitize_audit_value(actor_name),
            "requested_at": datetime.now(timezone.utc).isoformat(),
        }
    else:
        if not snapshot.get("rollback_available"):
            raise RuntimeError("No previous bot release is available to roll back to")
        if not snapshot.get("update_supported"):
            raise RuntimeError("The host release bridge is installed but its Compose deployment target is not configured")
        request = {
            "schema": 1,
            "action": action,
            "job_id": uuid.uuid4().hex[:24],
            "actor_id": sanitize_audit_value(actor_id),
            "actor_name": sanitize_audit_value(actor_name),
            "requested_at": datetime.now(timezone.utc).isoformat(),
        }
        # A local image pair is preferred. When it is unavailable, pass the
        # exact earlier GitHub release metadata selected by the agent; the
        # root bridge validates the repository, tag, URL and digest again
        # before downloading anything.
        if snapshot.get("github_rollback_available"):
            rollback = snapshot.get("github_rollback") if isinstance(snapshot.get("github_rollback"), dict) else {}
            request.update({
                "repository": snapshot.get("repository"),
                "tag": rollback.get("tag"),
                "version": rollback.get("version"),
                "asset_name": rollback.get("asset_name"),
                "asset_url": rollback.get("asset_url"),
                "asset_digest": rollback.get("asset_digest"),
            })
    try:
        _write_maintenance_request(request)
    except OSError as exc:
        raise RuntimeError("The bot release request could not be queued") from exc
    append_audit({
        "actor_id": sanitize_audit_value(actor_id),
        "actor_name": sanitize_audit_value(actor_name),
        "action": action,
        "service": "homelab-control",
        "result": "queued",
    })
    return {
        "accepted": True,
        "job_id": request["job_id"],
        "phase": "queued",
        "version": request.get("version") or snapshot.get("rollback_version"),
        "detail": "Verified bot release queued; the host bridge will rebuild only the control containers" if action == "bot_update" else "Bot rollback queued; the host bridge will restore the previous images or fetch the verified earlier GitHub release",
    }


def read_token():
    try:
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        token = os.getenv("CONTROL_TOKEN", "").strip()
    if len(token) < 32:
        raise RuntimeError("Controller token is missing or too short")
    return token


CONTROL_TOKEN = read_token()


class Handler(BaseHTTPRequestHandler):
    server_version = "HomelabControlAgent/0.1"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}")

    def send_json(self, status: int, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        supplied = self.headers.get("X-Homelab-Control-Token", "")
        return hmac.compare_digest(supplied, CONTROL_TOKEN)

    def require_auth(self):
        if self.authorized():
            return True
        self.send_json(401, {"ok": False, "error": "unauthorized"})
        return False

    def json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid request body")
        if length < 0 or length > 16_384:
            raise ValueError("Request body is too large")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Request body must be JSON") from exc
        if not isinstance(value, dict):
            raise ValueError("Request body must be an object")
        return value

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self.send_json(200, {"ok": True})
            return
        if not self.require_auth():
            return
        try:
            if parsed.path == "/v1/status":
                self.send_json(200, {"ok": True, "data": system_status()})
            elif parsed.path == "/v1/services":
                self.send_json(200, {"ok": True, "data": service_list()})
            elif parsed.path == "/v1/control-policy":
                self.send_json(200, {"ok": True, "data": control_policy()})
            elif parsed.path == "/v1/media":
                self.send_json(200, {"ok": True, "data": media_status()})
            elif parsed.path == "/v1/media-summary":
                self.send_json(200, {"ok": True, "data": media_summary()})
            elif parsed.path == "/v1/network":
                self.send_json(200, {"ok": True, "data": network_status()})
            elif parsed.path == "/v1/network-summary":
                self.send_json(200, {"ok": True, "data": network_summary()})
            elif parsed.path == "/v1/minecraft":
                self.send_json(200, {"ok": True, "data": minecraft_status()})
            elif parsed.path == "/v1/sessions":
                self.send_json(200, {"ok": True, "data": jellyfin_sessions()})
            elif parsed.path == "/v1/jellyfin":
                self.send_json(200, {"ok": True, "data": jellyfin_summary()})
            elif parsed.path == "/v1/plex":
                self.send_json(200, {"ok": True, "data": plex_summary()})
            elif parsed.path == "/v1/tasks":
                refresh = parse_qs(parsed.query).get("refresh", ["0"])[0] == "1"
                self.send_json(200, {"ok": True, "data": docker_resources(force=refresh)})
            elif parsed.path == "/v1/media-resources":
                refresh = parse_qs(parsed.query).get("refresh", ["0"])[0] == "1"
                self.send_json(200, {"ok": True, "data": media_resources(force=refresh)})
            elif parsed.path == "/v1/updates":
                refresh = parse_qs(parsed.query).get("refresh", ["0"])[0] == "1"
                self.send_json(200, {"ok": True, "data": updates_status(force=refresh)})
            elif parsed.path == "/v1/system-updates":
                self.send_json(200, {"ok": True, "data": system_updates()})
            elif parsed.path == "/v1/audit":
                self.send_json(200, {"ok": True, "data": recent_audit()})
            elif parsed.path.startswith("/v1/logs/"):
                key = parsed.path.removeprefix("/v1/logs/")
                tail = min(100, max(10, int(parse_qs(parsed.query).get("tail", ["40"])[0])))
                self.send_json(200, {"ok": True, "data": service_logs(key, tail)})
            else:
                self.send_json(404, {"ok": False, "error": "not_found"})
        except KeyError as exc:
            self.send_json(404, {"ok": False, "error": str(exc)})
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": exc.__class__.__name__})

    def do_POST(self):
        parsed = urlparse(self.path)
        if not self.require_auth():
            return
        if parsed.path == "/v1/control-policy":
            try:
                body = self.json_body()
                actor_id = self.headers.get("X-Discord-User-ID", "unknown")
                actor_name = self.headers.get("X-Discord-User-Name", "unknown")
                if "mode" in body:
                    result = set_control_mode(str(body.get("mode") or ""), actor_id, actor_name)
                else:
                    result = set_control_policy(
                        str(body.get("key") or ""),
                        body.get("enabled"),
                        actor_id,
                        actor_name,
                    )
                self.send_json(200, {"ok": True, "data": result})
            except PermissionError as exc:
                self.send_json(403, {"ok": False, "error": str(exc)})
            except KeyError as exc:
                self.send_json(404, {"ok": False, "error": str(exc)})
            except ValueError as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": exc.__class__.__name__})
            return
        if parsed.path == "/v1/system-updates/apply":
            try:
                result = _queue_system_request(
                    "apply_updates",
                    self.headers.get("X-Discord-User-ID", "unknown"),
                    self.headers.get("X-Discord-User-Name", "unknown"),
                )
                append_audit({
                    "actor_id": sanitize_audit_value(self.headers.get("X-Discord-User-ID")),
                    "actor_name": sanitize_audit_value(self.headers.get("X-Discord-User-Name")),
                    "action": "system_update",
                    "service": (host_os().get("name") or "host")[:80],
                    "result": "queued",
                })
                self.send_json(200, {"ok": True, "data": result})
            except ValueError as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            except RuntimeError as exc:
                self.send_json(409, {"ok": False, "error": str(exc)})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": exc.__class__.__name__})
            return
        if parsed.path == "/v1/system-updates/reboot":
            try:
                query_job_id = parse_qs(parsed.query).get("job_id", [""])[0]
                result = _queue_system_request(
                    "reboot",
                    self.headers.get("X-Discord-User-ID", "unknown"),
                    self.headers.get("X-Discord-User-Name", "unknown"),
                    query_job_id,
                )
                append_audit({
                    "actor_id": sanitize_audit_value(self.headers.get("X-Discord-User-ID")),
                    "actor_name": sanitize_audit_value(self.headers.get("X-Discord-User-Name")),
                    "action": "system_reboot",
                    "service": (host_os().get("name") or "host")[:80],
                    "result": "queued",
                })
                self.send_json(200, {"ok": True, "data": result})
            except ValueError as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            except RuntimeError as exc:
                self.send_json(409, {"ok": False, "error": str(exc)})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": exc.__class__.__name__})
            return
        if parsed.path in {"/v1/bot-release/update", "/v1/bot-release/rollback"}:
            try:
                action = "bot_update" if parsed.path.endswith("/update") else "bot_rollback"
                result = _queue_bot_release_request(
                    action,
                    self.headers.get("X-Discord-User-ID", "unknown"),
                    self.headers.get("X-Discord-User-Name", "unknown"),
                )
                self.send_json(200, {"ok": True, "data": result})
            except PermissionError as exc:
                self.send_json(403, {"ok": False, "error": str(exc)})
            except ValueError as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            except RuntimeError as exc:
                self.send_json(409, {"ok": False, "error": str(exc)})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": exc.__class__.__name__})
            return
        update_match = re.fullmatch(r"/v1/updates/(all|[a-z0-9][a-z0-9._-]{0,80})", parsed.path, re.IGNORECASE)
        if update_match:
            target = update_match.group(1)
            actor_id = self.headers.get("X-Discord-User-ID", "unknown")
            actor_name = self.headers.get("X-Discord-User-Name", "unknown")
            try:
                result = update_all(actor_id, actor_name) if target.lower() == "all" else update_app(target, actor_id, actor_name)
                self.send_json(200, {"ok": True, "data": result})
            except PermissionError as exc:
                self.send_json(403, {"ok": False, "error": str(exc)})
            except ValueError as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": exc.__class__.__name__})
            return
        match = re.fullmatch(r"/v1/services/([a-z0-9-]+)/(start|stop|restart)", parsed.path)
        if not match:
            self.send_json(404, {"ok": False, "error": "not_found"})
            return
        key, action = match.groups()
        try:
            result = manage_service(
                key,
                action,
                self.headers.get("X-Discord-User-ID", "unknown"),
                self.headers.get("X-Discord-User-Name", "unknown"),
            )
            self.send_json(200, result)
        except PermissionError as exc:
            self.send_json(403, {"ok": False, "error": str(exc)})
        except KeyError as exc:
            self.send_json(404, {"ok": False, "error": str(exc)})
        except ValueError as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": exc.__class__.__name__})


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"Homelab Control agent listening on {LISTEN_HOST}:{LISTEN_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
