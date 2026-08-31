#!/usr/bin/env python3
"""Small, local-only host bridge for guarded apt-based host maintenance.

The Discord bot never receives host root access.  The controller writes one
allowlisted request into the maintenance directory; this root-owned service
consumes it, runs only the host package/restart and control-release actions
below, and writes a sanitised status snapshot back for the controller to read.
"""

from __future__ import annotations

import json
import os
import re
import hashlib
import shutil
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


MAINTENANCE_DIR = Path(os.getenv("HOMELAB_CONTROL_MAINTENANCE_DIR", "/var/lib/homelab-control/maintenance"))
STATUS_FILE = MAINTENANCE_DIR / "status.json"
REQUEST_FILE = MAINTENANCE_DIR / "request.json"
BOT_RELEASE_STATUS_FILE = MAINTENANCE_DIR / "bot-release.json"
BOT_RELEASE_ROOT = Path(os.getenv("HOMELAB_CONTROL_RELEASE_ROOT", str(MAINTENANCE_DIR / "releases")))
BOT_RELEASE_REPOSITORY = os.getenv("HOMELAB_CONTROL_REPOSITORY", "").strip()
BOT_RELEASE_COMPOSE_FILE = Path(os.getenv("HOMELAB_CONTROL_COMPOSE_FILE", "")).expanduser() if os.getenv("HOMELAB_CONTROL_COMPOSE_FILE", "").strip() else None
BOT_RELEASE_ENV_FILE = Path(os.getenv("HOMELAB_CONTROL_ENV_FILE", "")).expanduser() if os.getenv("HOMELAB_CONTROL_ENV_FILE", "").strip() else None
BOT_RELEASE_COMPOSE_PROJECT = os.getenv("HOMELAB_CONTROL_COMPOSE_PROJECT", "").strip()
CONTROL_CONFIG_PATH = os.getenv("HOMELAB_CONTROL_CONFIG_FILE", "").strip() or os.getenv("HOMELAB_CONTROL_ENV_FILE", "").strip()
CONTROL_CONFIG_FILE = Path(CONTROL_CONFIG_PATH).expanduser() if CONTROL_CONFIG_PATH else None
BOT_SETTINGS_FILE = Path(os.getenv("HOMELAB_CONTROL_SETTINGS_FILE", "").expanduser()) if os.getenv("HOMELAB_CONTROL_SETTINGS_FILE", "").strip() else None
SETTINGS_BACKUP_ROOT = Path(os.getenv("HOMELAB_CONTROL_SETTINGS_BACKUP_ROOT", str(MAINTENANCE_DIR / "settings-backups")))
BOT_RELEASE_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024
BOT_RELEASE_TIMEOUT_SECONDS = 1800
BOT_RELEASE_REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]{1,39}/[A-Za-z0-9_.-]{1,100}$")
BOT_RELEASE_VERSION_RE = re.compile(r"^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:[a-z]|-[0-9A-Za-z.-]+)?$", re.IGNORECASE)
BOT_RELEASE_DIGEST_RE = re.compile(r"^sha256:[0-9a-fA-F]{64}$")
UPDATE_NOTIFIER_FILE = Path("/var/lib/update-notifier/updates-available")
OS_RELEASE_FILE = Path("/etc/os-release")
HOST_UPDATE_SUPPORTED_OS_IDS = {"ubuntu", "debian", "linuxmint", "pop", "elementary"}
REBOOT_MARKER = Path("/var/run/reboot-required")
BOOT_ID_FILE = Path("/proc/sys/kernel/random/boot_id")
POLL_SECONDS = 2.0
STATUS_INTERVAL_SECONDS = 300.0
COMMAND_TIMEOUT_SECONDS = 1800


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def boot_id() -> str:
    try:
        return BOOT_ID_FILE.read_text(encoding="utf-8").strip()[:120]
    except OSError:
        return "unknown"


def clean_line(value: str, maximum: int = 220) -> str:
    value = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", str(value or ""))
    value = re.sub(r"https://discord\.com/api/webhooks/[^\s]+", "[WEBHOOK REDACTED]", value, flags=re.I)
    value = re.sub(r"(?i)(password|token|secret|api[_-]?key)\s*[=:]\s*[^\s]+", r"\1=[REDACTED]", value)
    return " ".join(value.split())[:maximum]


def read_json(path: Path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def host_os():
    """Return a bounded identity for the host this root bridge runs on."""
    try:
        lines = OS_RELEASE_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return {"id": "unknown", "name": "Unknown OS", "pretty_name": "Unknown OS", "version_id": "", "source": "runtime"}
    values = {}
    for line in lines:
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in {"ID", "NAME", "PRETTY_NAME", "VERSION_ID"}:
            value = re.sub(r"[\r\n]+", " ", value.strip().strip('"').strip("'"))
            values[key] = re.sub(r"\s+", " ", value)
    identifier = re.sub(r"[^a-z0-9._+-]", "", values.get("ID", "").lower()) or "unknown"
    name = values.get("NAME") or identifier.title() or "Unknown OS"
    pretty = values.get("PRETTY_NAME") or name
    return {
        "id": identifier[:40],
        "name": name[:80],
        "pretty_name": pretty[:120],
        "version_id": re.sub(r"[^a-zA-Z0-9._+-]", "", values.get("VERSION_ID", ""))[:40],
        "source": "os-release",
    }


def write_json(path: Path, value: dict):
    MAINTENANCE_DIR.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    os.chmod(temporary, 0o644 if path == STATUS_FILE else 0o600)
    os.replace(temporary, path)


def notifier_summary():
    os_info = host_os()
    if os_info["id"] not in HOST_UPDATE_SUPPORTED_OS_IDS:
        return {
            "available": False,
            "os": os_info,
            "update_supported": False,
            "detail": f"{os_info['pretty_name']} is detected; this bridge only supports apt-based host updates",
        }
    try:
        text = UPDATE_NOTIFIER_FILE.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {"available": False, "os": os_info, "update_supported": True, "detail": f"{os_info['pretty_name']} update-notifier data is unavailable"}
    pending = None
    security = None
    match = re.search(r"(\d+)\s+updates? can be applied", text, re.I)
    if match:
        pending = int(match.group(1))
    match = re.search(r"(\d+)\s+of these updates? are standard security updates", text, re.I)
    if match:
        security = int(match.group(1))
    esm_disabled = "expanded security maintenance for applications is not enabled" in text.lower()
    return {
        "available": True,
        "os": os_info,
        "update_supported": True,
        "pending_count": pending,
        "security_count": security,
        "esm_enabled": not esm_disabled,
        "notice": "ESM Apps is not enabled" if esm_disabled else None,
    }


def security_origin(origin: str) -> bool:
    """Return whether an apt origin is a supported security repository."""
    value = str(origin or "").lower()
    return any(marker in value for marker in ("-security", "security.ubuntu.com", "esm.ubuntu.com"))


def simulated_update_details():
    """Read the package manager's planned upgrades without changing state."""
    try:
        result = subprocess.run(
            ["/usr/bin/apt-get", "-s", "upgrade"],
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
            env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return {"packages": [], "deferred_packages": []}
    packages = []
    deferred_packages = []
    reading_deferred = False
    for line in result.stdout.splitlines():
        if line.startswith("The following upgrades have been deferred due to phasing:"):
            reading_deferred = True
            continue
        if reading_deferred:
            if line.startswith("  "):
                deferred_packages.extend(line.split())
                continue
            reading_deferred = False
        match = re.match(r"^Inst\s+(\S+)(?:\s+\[[^\]]+\])?\s+\((\S+)(?:\s+([^)]+))?\)", line)
        if not match:
            continue
        origin = clean_line(match.group(3) or "", 120)
        origin = re.sub(r"\s+\[[^\]]+\]$", "", origin)
        packages.append({
            "name": clean_line(match.group(1), 100),
            "latest": clean_line(match.group(2), 120),
            "origin": origin,
            "security": security_origin(origin),
        })
    return {
        "packages": packages[:100],
        "deferred_packages": [clean_line(name, 100) for name in deferred_packages[:100]],
    }


def simulated_updates():
    """Backward-compatible list of the simulated upgrade packages."""
    return simulated_update_details()["packages"]


def host_update_snapshot():
    os_info = host_os()
    if os_info["id"] not in HOST_UPDATE_SUPPORTED_OS_IDS:
        return {
            "available": False,
            "os": os_info,
            "update_supported": False,
            "checked_at": timestamp(),
            "detail": f"{os_info['pretty_name']} is detected; this bridge only supports apt-based host updates",
        }
    notifier = notifier_summary()
    simulated = simulated_update_details()
    packages = simulated["packages"]
    deferred_packages = simulated["deferred_packages"]
    if not notifier.get("available") and not packages:
        return {"available": False, "os": os_info, "update_supported": True, "detail": notifier.get("detail", f"{os_info['pretty_name']} update status unavailable")}
    pending = len(packages) if packages else notifier.get("pending_count")
    security_packages = [package["name"] for package in packages if package.get("security")]
    notifier_security = notifier.get("security_count")
    security_count = len(security_packages) if packages else notifier_security
    # The notifier can include security updates that apt has deferred due to
    # phasing, so retain an explicit notifier count when it is higher.
    if notifier_security is not None and security_count is not None:
        security_count = max(security_count, notifier_security)
    if security_count is None:
        security_detail = "Security classification unavailable from the current package metadata"
    elif security_count == 0:
        security_detail = f"No {os_info['name']} security updates in the current upgrade plan"
    elif security_packages:
        security_detail = "Security packages are marked with a lock icon below"
    else:
        security_detail = f"{os_info['name']} reports security updates, but apt is currently deferring their package plan"
    result = {
        "available": True,
        "os": os_info,
        "update_supported": True,
        "checked_at": timestamp(),
        "pending_count": pending,
        "security_count": security_count,
        "security_detail": security_detail,
        "security_packages": security_packages[:100],
        "standard_packages": [package["name"] for package in packages if not package.get("security")][:100],
        "deferred_packages": deferred_packages,
        "deferred_count": len(deferred_packages),
        "esm_enabled": notifier.get("esm_enabled"),
        "notice": notifier.get("notice"),
        "packages": packages,
    }
    return result


def append_event(status: dict, message: str):
    events = status.setdefault("events", [])
    events.append({"at": timestamp(), "message": clean_line(message)})
    status["events"] = events[-12:]


def save_status(status: dict):
    status["updated_at"] = timestamp()
    write_json(STATUS_FILE, status)


def bot_update_supported() -> bool:
    return bool(
        BOT_RELEASE_REPOSITORY_RE.fullmatch(BOT_RELEASE_REPOSITORY)
        and BOT_RELEASE_COMPOSE_FILE
        and BOT_RELEASE_COMPOSE_FILE.is_file()
        and Path(docker_binary()).is_file()
    )


def write_bot_status(status: dict):
    status["updated_at"] = timestamp()
    write_json(BOT_RELEASE_STATUS_FILE, status)


def read_bot_status():
    return read_json(BOT_RELEASE_STATUS_FILE)


def base_bot_status(existing=None):
    status = dict(existing or {})
    status["kind"] = "bot"
    status.setdefault("schema", 1)
    status.setdefault("phase", "idle")
    status.setdefault("job_id", None)
    status.setdefault("events", [])
    status.setdefault("rollback_available", False)
    status.setdefault("update_supported", bot_update_supported())
    status.setdefault("automatic", False)
    return status


def append_bot_event(status: dict, message: str):
    events = status.setdefault("events", [])
    events.append({"at": timestamp(), "message": clean_line(message)})
    status["events"] = events[-12:]


def bot_version(value: str):
    match = BOT_RELEASE_VERSION_RE.fullmatch(str(value or "").strip())
    if not match:
        return None
    value = str(value).strip().lstrip("v")
    return value[:-1] + value[-1].lower() if re.fullmatch(r"\d+\.\d+\.\d+[a-z]", value, re.IGNORECASE) else value


def _release_version_key(value):
    """Return a stable-channel comparison key for a validated release tag."""
    normalised = bot_version(value)
    if not normalised:
        return None
    if re.fullmatch(r"\d+\.\d+\.\d+[a-z]", normalised, re.IGNORECASE):
        base = normalised[:-1]
        numbers = tuple(int(part) for part in base.split("."))
        return (*numbers, 2, ((1, normalised[-1].lower()),))
    base, _, prerelease = normalised.partition("-")
    numbers = tuple(int(part) for part in base.split("."))
    if not prerelease:
        return (*numbers, 1, ())
    tokens = []
    for token in prerelease.split("."):
        tokens.append((0, int(token)) if token.isdigit() else (1, token.lower()))
    return (*numbers, 0, tuple(tokens))


def docker_binary():
    return shutil.which("docker") or "/usr/bin/docker"


def compose_base_command():
    if not bot_update_supported():
        raise RuntimeError("The bot release bridge has no valid Compose deployment target")
    command = [docker_binary(), "compose"]
    if BOT_RELEASE_ENV_FILE:
        if not BOT_RELEASE_ENV_FILE.is_file():
            raise RuntimeError("The configured Compose environment file does not exist")
        command.extend(["--env-file", str(BOT_RELEASE_ENV_FILE)])
    if BOT_RELEASE_COMPOSE_PROJECT:
        command.extend(["-p", BOT_RELEASE_COMPOSE_PROJECT])
    command.extend(["-f", str(BOT_RELEASE_COMPOSE_FILE)])
    return command


def compose_service_image(service: str):
    command = compose_base_command() + ["ps", "-q", service]
    result = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
    container_id = result.stdout.strip().splitlines()[0] if result.returncode == 0 and result.stdout.strip() else ""
    if not container_id:
        return None
    inspect = subprocess.run(
        [docker_binary(), "inspect", container_id, "--format", "{{.Config.Image}}"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    image = inspect.stdout.strip()
    return image or None


def compose_override(path: Path, contexts=None, images=None):
    contexts = contexts or {}
    images = images or {}

    def quote(value):
        return json.dumps(str(value))

    lines = ["services:"]
    for service in ("agent", "bot"):
        lines.extend([f"  {service}:"])
        if service in contexts:
            lines.extend(["    build:", f"      context: {quote(contexts[service])}"])
        else:
            lines.append("    build: null")
        lines.extend([
            f"    image: {quote(images[service])}",
            "    pull_policy: never",
        ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def wait_control_health(status: dict, timeout: float = 150.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        healthy = True
        details = []
        for service in ("agent", "bot"):
            try:
                image = compose_service_image(service)
                if not image:
                    healthy = False
                    details.append(f"{service}: container not found")
                    continue
                command = compose_base_command() + ["ps", "-q", service]
                result = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
                container_id = result.stdout.strip().splitlines()[0] if result.returncode == 0 and result.stdout.strip() else ""
                inspect = subprocess.run(
                    [docker_binary(), "inspect", container_id, "--format", "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}"],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
                state, health = (inspect.stdout.strip().split("|", 1) + ["unknown"])[:2]
                if state != "running" or health not in {"healthy", "none"}:
                    healthy = False
                    details.append(f"{service}: {state or 'unknown'} / {health or 'unknown'}")
                else:
                    details.append(f"{service}: healthy")
            except (OSError, subprocess.SubprocessError) as exc:
                healthy = False
                details.append(f"{service}: {exc.__class__.__name__}")
        append_bot_event(status, " · ".join(details))
        write_bot_status(status)
        if healthy:
            return True
        time.sleep(3)
    return False


def validated_release_request(request: dict):
    repository = str(request.get("repository") or "").strip()
    tag = str(request.get("tag") or "").strip()
    version = bot_version(str(request.get("version") or ""))
    selected_version = request.get("selected_version")
    if selected_version is not None and bot_version(str(selected_version)) != version:
        raise RuntimeError("The selected rollback version does not match its release metadata")
    asset_name = str(request.get("asset_name") or "").strip()
    asset_url = str(request.get("asset_url") or "").strip()
    digest = str(request.get("asset_digest") or "").strip().lower()
    if repository != BOT_RELEASE_REPOSITORY or not BOT_RELEASE_REPOSITORY_RE.fullmatch(repository):
        raise RuntimeError("The release repository does not match the configured repository")
    if not tag or bot_version(tag) != version:
        raise RuntimeError("The release tag is not a valid semantic version")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,160}\.(?:tar\.gz|tgz)", asset_name, re.I):
        raise RuntimeError("The release archive name is not allowed")
    parsed = urllib.parse.urlparse(asset_url)
    expected_path = f"/{repository}/releases/download/{tag}/{asset_name}"
    if parsed.scheme != "https" or parsed.netloc.lower() != "github.com" or parsed.path != expected_path or parsed.query or parsed.fragment:
        raise RuntimeError("The release archive URL is not an exact GitHub release asset URL")
    if not BOT_RELEASE_DIGEST_RE.fullmatch(digest):
        raise RuntimeError("The release archive has no valid SHA-256 digest")
    return repository, tag, version, asset_name, asset_url, digest


def download_release_archive(status: dict, request: dict, destination: Path, digest: str):
    append_bot_event(status, "Downloading the verified GitHub release archive")
    write_bot_status(status)
    http_request = urllib.request.Request(
        request["asset_url"],
        headers={"Accept": "application/octet-stream", "User-Agent": "Homelab-Control-release-bridge"},
    )
    try:
        with urllib.request.urlopen(http_request, timeout=60) as response, destination.open("wb") as output:
            hasher = hashlib.sha256()
            total = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > BOT_RELEASE_MAX_ARCHIVE_BYTES:
                    raise RuntimeError("The release archive exceeds the safety size limit")
                hasher.update(chunk)
                output.write(chunk)
    except (OSError, urllib.error.URLError) as exc:
        raise RuntimeError(f"Could not download the GitHub release archive ({exc.__class__.__name__})") from exc
    actual = f"sha256:{hasher.hexdigest()}"
    if actual.lower() != digest.lower():
        raise RuntimeError("The downloaded archive failed its SHA-256 verification")
    append_bot_event(status, "SHA-256 verification passed")
    write_bot_status(status)


def safe_extract_release(archive: Path, destination: Path):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:*") as tar:
        members = tar.getmembers()
        if len(members) > 10_000:
            raise RuntimeError("The release archive contains too many entries")
        for member in members:
            name = Path(member.name)
            if name.is_absolute() or ".." in name.parts or member.issym() or member.islnk() or not (member.isdir() or member.isfile()):
                raise RuntimeError("The release archive contains an unsafe path or entry")
        tar.extractall(destination, members=members)
    roots = [destination]
    children = [item for item in destination.iterdir() if item.is_dir()]
    if len(children) == 1 and (children[0] / "agent").is_dir() and (children[0] / "bot").is_dir():
        roots = [children[0]]
    source = roots[0]
    for required in (source / "agent" / "Dockerfile", source / "agent" / "agent.py", source / "bot" / "Dockerfile", source / "bot" / "package.json", source / "bot" / "package-lock.json"):
        if not required.is_file():
            raise RuntimeError(f"The release archive is missing {required.relative_to(source)}")
    return source


def release_snapshot():
    return {
        "agent_image": compose_service_image("agent"),
        "bot_image": compose_service_image("bot"),
    }


def snapshot_version(snapshot):
    images = [snapshot.get("bot_image"), snapshot.get("agent_image")]
    for image in images:
        match = re.search(r":(v?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:[a-z]|-[0-9A-Za-z.-]+)?)$", str(image or ""), re.IGNORECASE)
        if match:
            return bot_version(match.group(1))
    return "previous release"


def restore_release(status: dict, snapshot: dict):
    if not snapshot.get("agent_image") or not snapshot.get("bot_image"):
        return False
    override = BOT_RELEASE_ROOT / f"rollback-{status.get('job_id') or 'current'}.yml"
    try:
        override.parent.mkdir(parents=True, exist_ok=True)
        compose_override(override, images={"agent": snapshot["agent_image"], "bot": snapshot["bot_image"]})
        append_bot_event(status, "Restoring the previous control images")
        write_bot_status(status)
        command = compose_base_command() + ["-f", str(override), "up", "-d", "--no-deps", "agent", "bot"]
        if not run_bot_command(status, command, "Switching back to the previous control release"):
            return False
        return wait_control_health(status)
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return False
    finally:
        try:
            override.unlink()
        except OSError:
            pass


def stage_verified_release(status: dict, request: dict, validated):
    """Download, verify and stage one exact GitHub release archive."""
    _repository, _tag, version, asset_name, _asset_url, digest = validated
    status.update({"phase": "downloading", "requested_version": version, "asset_name": asset_name})
    write_bot_status(status)
    BOT_RELEASE_ROOT.mkdir(parents=True, exist_ok=True)
    os.chmod(BOT_RELEASE_ROOT, 0o700)
    with tempfile.TemporaryDirectory(prefix="homelab-control-release-", dir=str(BOT_RELEASE_ROOT)) as temporary:
        temporary_path = Path(temporary)
        archive = temporary_path / asset_name
        download_release_archive(status, request, archive, digest)
        status["phase"] = "verifying"
        append_bot_event(status, "Checking the archive layout and required control files")
        write_bot_status(status)
        extracted = temporary_path / "source"
        source = safe_extract_release(archive, extracted)
        staged = BOT_RELEASE_ROOT / version
        if staged.exists():
            shutil.rmtree(staged)
        shutil.move(str(source), str(staged))
    status["phase"] = "staging"
    append_bot_event(status, f"Release {version} staged")
    write_bot_status(status)
    return staged, version


def run_bot_update(request: dict):
    status = base_bot_status(read_bot_status())
    status.update({"phase": "checking", "job_id": request.get("job_id"), "started_at": timestamp(), "requested_version": None, "detail": None, "events": [], "update_supported": bot_update_supported(), "automatic": bool(request.get("automatic"))})
    write_bot_status(status)
    snapshot = None
    try:
        _backup_settings_before(status, "the release update")
        validated = validated_release_request(request)
        _repository, _tag, version, asset_name, _asset_url, digest = validated
        snapshot = release_snapshot()
        if not snapshot.get("agent_image") or not snapshot.get("bot_image"):
            raise RuntimeError("The control containers are not both running; update was not attempted")
        staged, version = stage_verified_release(status, request, validated)
        override = BOT_RELEASE_ROOT / f"update-{status.get('job_id') or version}.yml"
        compose_override(override, contexts={"agent": staged / "agent", "bot": staged / "bot"}, images={"agent": f"local/homelab-control-agent:{version}", "bot": f"local/homelab-control-bot:{version}"})
        try:
            status["phase"] = "building"
            append_bot_event(status, "Validating the Compose merge before building")
            write_bot_status(status)
            config_check = compose_base_command() + ["-f", str(override), "config", "--quiet"]
            if not run_bot_command(status, config_check, "Checking the release Compose definition"):
                raise RuntimeError("The release Compose definition failed validation")
            if not run_bot_command(status, compose_base_command() + ["-f", str(override), "build", "agent", "bot"], "Building the new control images"):
                raise RuntimeError("The control image build failed; the previous release was kept")
            status["phase"] = "restarting"
            append_bot_event(status, "Recreating only the control agent and Discord bot")
            write_bot_status(status)
            if not run_bot_command(status, compose_base_command() + ["-f", str(override), "up", "-d", "--no-deps", "agent", "bot"], "Starting the new control containers"):
                raise RuntimeError("The control containers could not be started")
            status["phase"] = "verifying_runtime"
            append_bot_event(status, "Waiting for agent and bot health checks")
            write_bot_status(status)
            if not wait_control_health(status):
                raise RuntimeError("The new control containers did not become healthy")
        except Exception:
            status["phase"] = "failed"
            if snapshot and restore_release(status, snapshot):
                status["detail"] = "The new release failed verification; the previous control release was restored"
                status["current_version"] = snapshot_version(snapshot)
                status["rollback_available"] = bool(read_bot_status().get("rollback_available"))
            else:
                status["detail"] = "The new release failed and automatic restoration could not be verified"
            write_bot_status(status)
            return
        status.update({
            "phase": "complete",
            "current_version": version,
            "previous_version": snapshot_version(snapshot),
            "rollback_source": "local",
            "rollback_images": snapshot,
            "rollback_available": True,
            "completed_at": timestamp(),
            "detail": f"Release {version} is running and both control health checks passed",
        })
        append_bot_event(status, "Bot release applied and verified")
        write_bot_status(status)
    except Exception as exc:
        status["phase"] = "failed"
        status["detail"] = clean_line(str(exc), 240)
        append_bot_event(status, "Bot release was refused before changing containers")
        write_bot_status(status)


def run_bot_rollback(request: dict):
    status = base_bot_status(read_bot_status())
    status.update({"phase": "checking", "job_id": request.get("job_id"), "started_at": timestamp(), "requested_version": None, "detail": None, "events": [], "update_supported": bot_update_supported(), "automatic": False})
    write_bot_status(status)
    current = None
    restore_attempted = False
    local_restore_succeeded = False
    try:
        _backup_settings_before(status, "the release rollback")
        snapshot = status.get("rollback_images")
        current = release_snapshot()
        if not current.get("agent_image") or not current.get("bot_image"):
            raise RuntimeError("The running control containers could not be identified; rollback was not attempted")
        # An explicit GitHub selection must be honoured even when a retained
        # image pair exists; the local shortcut is reserved for the default
        # “previous release” action or an explicitly selected local version.
        explicit_github_selection = bool(request.get("selected_version") and request.get("asset_url"))
        using_local_images = bool(
            not explicit_github_selection
            and status.get("rollback_available")
            and isinstance(snapshot, dict)
            and snapshot.get("agent_image")
            and snapshot.get("bot_image")
        )
        if using_local_images:
            target_version = snapshot_version(snapshot)
            status["phase"] = "restarting"
            append_bot_event(status, f"Restoring control release {target_version} from retained images")
            write_bot_status(status)
            restore_attempted = True
            if restore_release(status, snapshot):
                local_restore_succeeded = True
            else:
                # A retained pair can be pruned or become unusable while the
                # GitHub release remains available.  Continue with the exact
                # metadata selected by the agent instead of leaving the user
                # with a dead Revert button.
                append_bot_event(status, "Retained images did not pass health checks; trying the verified GitHub release")
                write_bot_status(status)
                using_local_images = False
        if not using_local_images:
            # A fresh install, a pruned image pair, a failed local restore, or
            # an explicit older-version choice can fetch a verified GitHub
            # release selected by the agent.
            validated = validated_release_request(request)
            _repository, _tag, target_version, _asset_name, _asset_url, _digest = validated
            current_version = snapshot_version(current)
            if _release_version_key(target_version) and _release_version_key(current_version) and _release_version_key(target_version) >= _release_version_key(current_version):
                raise RuntimeError("The requested GitHub release is not earlier than the running release")
            staged, target_version = stage_verified_release(status, request, validated)
            override = BOT_RELEASE_ROOT / f"rollback-update-{status.get('job_id') or target_version}.yml"
            compose_override(override, contexts={"agent": staged / "agent", "bot": staged / "bot"}, images={"agent": f"local/homelab-control-agent:{target_version}", "bot": f"local/homelab-control-bot:{target_version}"})
            try:
                status["phase"] = "building"
                append_bot_event(status, "Validating the rollback Compose merge")
                write_bot_status(status)
                if not run_bot_command(status, compose_base_command() + ["-f", str(override), "config", "--quiet"], "Checking the rollback Compose definition"):
                    raise RuntimeError("The rollback Compose definition failed validation")
                if not run_bot_command(status, compose_base_command() + ["-f", str(override), "build", "agent", "bot"], "Building the previous control images"):
                    raise RuntimeError("The previous control image build failed")
                status["phase"] = "restarting"
                append_bot_event(status, f"Recreating the control containers with release {target_version}")
                write_bot_status(status)
                if not run_bot_command(status, compose_base_command() + ["-f", str(override), "up", "-d", "--no-deps", "agent", "bot"], "Starting the previous control release"):
                    raise RuntimeError("The previous control containers could not be started")
                status["phase"] = "verifying_runtime"
                append_bot_event(status, "Waiting for agent and bot health checks")
                write_bot_status(status)
                if not wait_control_health(status):
                    raise RuntimeError("The fetched previous control release did not become healthy")
            except Exception:
                if current and restore_release(status, current):
                    status["detail"] = "The fetched previous release failed verification; the current control release was restored"
                else:
                    status["detail"] = "The fetched previous release failed and automatic restoration could not be verified"
                status["phase"] = "failed"
                write_bot_status(status)
                return
            finally:
                try:
                    override.unlink()
                except OSError:
                    pass
            append_bot_event(status, f"Fetched and verified GitHub release {target_version}")
        status.update({
            "phase": "rolled_back",
            "current_version": target_version,
            "previous_version": snapshot_version(current),
            "rollback_source": "local" if using_local_images else "github",
            "rollback_images": current,
            "rollback_available": bool(current.get("agent_image") and current.get("bot_image")),
            "completed_at": timestamp(),
            "detail": f"Release {target_version} is running and both control health checks passed",
        })
        append_bot_event(status, "Previous bot release restored and verified")
        write_bot_status(status)
    except Exception as exc:
        # If a retained-image attempt changed the control pair and no GitHub
        # fallback was available, put the running pair back before reporting
        # the refusal.  The nested GitHub path already performs this recovery
        # for failures after its own switch attempt.
        if current and restore_attempted and not local_restore_succeeded:
            restore_release(status, current)
        status["phase"] = "failed"
        status["detail"] = clean_line(str(exc), 240)
        append_bot_event(status, "Rollback was refused or could not be verified")
        write_bot_status(status)


def _backup_control_config():
    """Create a private, timestamped config backup before recovery changes."""
    if not CONTROL_CONFIG_FILE or not CONTROL_CONFIG_FILE.is_file():
        return None
    SETTINGS_BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    os.chmod(SETTINGS_BACKUP_ROOT, 0o700)
    backup = SETTINGS_BACKUP_ROOT / f"config-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.env"
    shutil.copyfile(CONTROL_CONFIG_FILE, backup)
    os.chmod(backup, 0o600)
    return backup


def _backup_runtime_settings():
    """Back up the bot's writable settings overlay when the host path is configured."""
    if not BOT_SETTINGS_FILE or not BOT_SETTINGS_FILE.is_file():
        return None
    SETTINGS_BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    os.chmod(SETTINGS_BACKUP_ROOT, 0o700)
    backup = SETTINGS_BACKUP_ROOT / f"runtime-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    shutil.copyfile(BOT_SETTINGS_FILE, backup)
    os.chmod(backup, 0o600)
    return backup


def _latest_config_backup():
    if not SETTINGS_BACKUP_ROOT.is_dir():
        return None
    candidates = sorted(SETTINGS_BACKUP_ROOT.glob("config-*.env"), key=lambda path: path.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def _latest_runtime_backup():
    if not SETTINGS_BACKUP_ROOT.is_dir():
        return None
    candidates = sorted(SETTINGS_BACKUP_ROOT.glob("runtime-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def _restore_config_file(backup: Path):
    if not CONTROL_CONFIG_FILE or not backup or not backup.is_file():
        raise RuntimeError("No configuration backup is available")
    CONTROL_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = CONTROL_CONFIG_FILE.with_suffix(CONTROL_CONFIG_FILE.suffix + ".tmp")
    shutil.copyfile(backup, temporary)
    os.chmod(temporary, 0o600)
    os.replace(temporary, CONTROL_CONFIG_FILE)


def _restore_runtime_settings(backup: Path):
    if not BOT_SETTINGS_FILE or not backup or not backup.is_file():
        raise RuntimeError("No runtime settings backup is available")
    BOT_SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = BOT_SETTINGS_FILE.with_suffix(BOT_SETTINGS_FILE.suffix + ".tmp")
    shutil.copyfile(backup, temporary)
    os.chmod(temporary, 0o600)
    os.replace(temporary, BOT_SETTINGS_FILE)


def _reset_runtime_settings():
    if not BOT_SETTINGS_FILE:
        return False
    BOT_SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = BOT_SETTINGS_FILE.with_suffix(BOT_SETTINGS_FILE.suffix + ".tmp")
    temporary.write_text("{}\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, BOT_SETTINGS_FILE)
    return True


def _reset_control_config():
    """Clear the optional bot config atomically after its backup is created."""
    if not CONTROL_CONFIG_FILE:
        return False
    CONTROL_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = CONTROL_CONFIG_FILE.with_suffix(CONTROL_CONFIG_FILE.suffix + ".tmp")
    temporary.write_text("", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, CONTROL_CONFIG_FILE)
    return True


def _backup_settings_before(status: dict, reason: str):
    """Create private config/runtime backups before a control-plane change."""
    config_backup = _backup_control_config()
    runtime_backup = _backup_runtime_settings()
    kinds = []
    if config_backup:
        kinds.append("configuration")
    if runtime_backup:
        kinds.append("runtime settings")
    if kinds:
        append_bot_event(status, f"Private {' + '.join(kinds)} backup created before {reason}")
        write_bot_status(status)
    return config_backup, runtime_backup


def run_bot_maintenance(request: dict):
    """Handle non-release recovery actions through the same health-checked path."""
    action = str(request.get("action") or "")
    status = base_bot_status(read_bot_status())
    status.update({"phase": "checking", "job_id": request.get("job_id"), "started_at": timestamp(), "detail": None, "events": [], "update_supported": bot_update_supported(), "automatic": False})
    write_bot_status(status)
    backup = None
    runtime_backup = None
    try:
        if action == "settings_reset":
            backup = _backup_control_config()
            runtime_backup = _backup_runtime_settings()
            config_reset = _reset_control_config()
            runtime_reset = _reset_runtime_settings()
            if not config_reset and not runtime_reset:
                raise RuntimeError("No host settings paths are configured for recovery")
            detail = "Configuration and runtime settings were cleared; a private backup was created before the reset"
            if config_reset and BOT_RELEASE_ENV_FILE and CONTROL_CONFIG_FILE and CONTROL_CONFIG_FILE == BOT_RELEASE_ENV_FILE:
                detail += ". The running containers were left online because this file also supplies Compose values; restore the backup before a future restart"
            elif config_reset:
                detail += ". The running containers remain online until the next controlled restart"
            if not config_reset:
                detail += "; no separate config file was configured"
            if not runtime_reset:
                detail += "; no runtime overlay was configured"
            status.update({"phase": "complete", "current_version": snapshot_version(release_snapshot()), "completed_at": timestamp(), "detail": detail})
            append_bot_event(status, "Configuration and runtime settings reset completed with private backups")
            write_bot_status(status)
            return
        if action == "settings_restore":
            backup = _backup_control_config()
            runtime_backup = _backup_runtime_settings()
            config_candidates = sorted(SETTINGS_BACKUP_ROOT.glob("config-*.env"), key=lambda path: path.stat().st_mtime, reverse=True)
            runtime_candidates = sorted(SETTINGS_BACKUP_ROOT.glob("runtime-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
            previous_config = next((path for path in config_candidates if path != backup), None)
            previous_runtime = next((path for path in runtime_candidates if path != runtime_backup), None)
            if previous_config:
                _restore_config_file(previous_config)
            if previous_runtime:
                _restore_runtime_settings(previous_runtime)
            if not previous_config and not previous_runtime:
                raise RuntimeError("No previous settings backup is available")
            append_bot_event(status, "Previous settings backup restored; recreating the control containers")
        elif action in {"bot_restart", "bot_repair"}:
            if action == "bot_repair" and bool(request.get("fresh")):
                backup = _backup_control_config()
                runtime_backup = _backup_runtime_settings()
                if CONTROL_CONFIG_FILE:
                    CONTROL_CONFIG_FILE.write_text("# Fresh repair requested by Homelab Control; restore the backup to keep the old pairing.\n", encoding="utf-8")
                    os.chmod(CONTROL_CONFIG_FILE, 0o600)
                runtime_reset = _reset_runtime_settings()
                if not CONTROL_CONFIG_FILE and not runtime_reset:
                    raise RuntimeError("No host settings paths are configured for fresh repair")
                append_bot_event(status, "Fresh repair staged after backing up the current settings")
            else:
                append_bot_event(status, "Recreating the control containers with the current config")
        else:
            raise RuntimeError("Unknown bot maintenance action")
        status["phase"] = "restarting"
        write_bot_status(status)
        command = compose_base_command() + ["up", "-d", "--force-recreate", "--no-deps", "agent", "bot"]
        if not run_bot_command(status, command, "Starting the repaired control containers"):
            raise RuntimeError("The control containers could not be started")
        status["phase"] = "verifying_runtime"
        write_bot_status(status)
        if not wait_control_health(status):
            raise RuntimeError("The repaired control containers did not become healthy")
        status.update({"phase": "complete", "current_version": snapshot_version(release_snapshot()), "completed_at": timestamp(), "detail": "Control recovery completed and both health checks passed"})
        append_bot_event(status, "Control recovery completed and verified")
        write_bot_status(status)
    except Exception as exc:
        # A failed fresh repair must not strand a working deployment. Restore
        # the exact pre-action config and report the recovery honestly.
        restored = False
        if backup and CONTROL_CONFIG_FILE and CONTROL_CONFIG_FILE.is_file():
            try:
                _restore_config_file(backup)
                restored = True
            except Exception:
                pass
        if runtime_backup and BOT_SETTINGS_FILE and BOT_SETTINGS_FILE.is_file():
            try:
                _restore_runtime_settings(runtime_backup)
                restored = True
            except Exception:
                pass
        if restored:
            append_bot_event(status, "Recovery failed; the pre-action settings backup was restored")
        elif backup or runtime_backup:
            append_bot_event(status, "Recovery failed and the settings backup could not be restored automatically")
        status["phase"] = "failed"
        status["detail"] = clean_line(str(exc), 240)
        write_bot_status(status)
def base_status(existing=None):
    status = dict(existing or {})
    status["kind"] = "host"
    status.setdefault("schema", 1)
    status.setdefault("phase", "idle")
    status.setdefault("job_id", None)
    status.setdefault("events", [])
    status.setdefault("boot_id", boot_id())
    status.setdefault("reboot_required", REBOOT_MARKER.exists())
    return status


def run_command(status: dict, command: list[str], label: str, *, append_fn=append_event, save_fn=save_status, operation="package manager") -> bool:
    append_fn(status, label)
    save_fn(status)
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env={**os.environ, "DEBIAN_FRONTEND": "noninteractive", "NEEDRESTART_MODE": "a"},
        )
        assert process.stdout is not None
        for line in process.stdout:
            line = clean_line(line)
            if line:
                append_fn(status, line)
                save_fn(status)
        return_code = process.wait(timeout=COMMAND_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        append_fn(status, f"The {operation} timed out; no host reboot was requested")
        status["phase"] = "failed"
        status["detail"] = f"{host_os()['name']} {operation} timed out"
        save_fn(status)
        return False
    except OSError as exc:
        append_fn(status, f"Could not start {operation} ({exc.__class__.__name__})")
        status["phase"] = "failed"
        status["detail"] = f"{host_os()['name']} {operation} could not be started"
        save_fn(status)
        return False
    if return_code != 0:
        append_fn(status, f"The {operation} exited with code {return_code}")
        status["phase"] = "failed"
        status["detail"] = f"{host_os()['name']} {operation} failed (exit {return_code})"
        save_fn(status)
        return False
    return True


def run_bot_command(status: dict, command: list[str], label: str) -> bool:
    """Run a control-release command without touching host-maintenance state."""
    return run_command(status, command, label, append_fn=append_bot_event, save_fn=write_bot_status, operation="control release command")


def apply_updates(request: dict):
    status = base_status()
    status.update({"phase": "checking", "job_id": request.get("job_id"), "started_at": timestamp(), "detail": None, "events": []})
    snapshot = host_update_snapshot()
    status.update(snapshot)
    if not status.get("update_supported", False):
        status["phase"] = "failed"
        append_event(status, status.get("detail") or "Host update bridge does not support this operating system")
        save_status(status)
        return
    os_name = (status.get("os") or {}).get("name", "Host")
    append_event(status, f"{os_name} maintenance accepted; no automatic reboot will be performed")
    save_status(status)
    if not run_command(status, ["/usr/bin/apt-get", "update"], f"Refreshing the {os_name} package catalogue"):
        return
    status["phase"] = "applying"
    append_event(status, f"Applying standard {os_name} upgrades (configuration files are kept)")
    save_status(status)
    if not run_command(
        status,
        ["/usr/bin/apt-get", "-y", "-o", "Dpkg::Options::=--force-confold", "upgrade"],
        f"Installing available {os_name} updates",
    ):
        return
    snapshot = host_update_snapshot()
    status.update(snapshot)
    status["reboot_required"] = REBOOT_MARKER.exists()
    status["phase"] = "ready_for_reboot" if status["reboot_required"] else "complete"
    status["completed_at"] = timestamp()
    append_event(status, "Updates applied successfully")
    if status["reboot_required"]:
        append_event(status, f"{os_name} reports that a restart is required; waiting for your confirmation")
    else:
        append_event(status, f"{os_name} does not currently report a restart requirement")
    save_status(status)


def request_reboot(request: dict):
    status = base_status(read_json(STATUS_FILE))
    if not request.get("job_id") or request.get("job_id") != status.get("job_id"):
        status["phase"] = "failed"
        status["detail"] = "Restart request did not match the current maintenance job"
        append_event(status, "Restart refused because the maintenance job did not match")
        save_status(status)
        return
    if status.get("phase") != "ready_for_reboot" or not REBOOT_MARKER.exists():
        status["phase"] = "failed"
        status["detail"] = "The host is not waiting for a confirmed restart"
        append_event(status, "Restart refused because no confirmed reboot is pending")
        save_status(status)
        return
    status["phase"] = "rebooting"
    status["reboot_requested_at"] = timestamp()
    status["boot_id"] = boot_id()
    append_event(status, "Restart confirmed; the controller will announce when the host is back online")
    save_status(status)
    time.sleep(1)
    try:
        result = subprocess.run(["/usr/bin/systemctl", "reboot"], check=False, timeout=15)
        if result.returncode != 0:
            status["phase"] = "failed"
            status["detail"] = "systemctl reboot returned a failure"
            append_event(status, f"The restart command returned code {result.returncode}")
            save_status(status)
    except (OSError, subprocess.TimeoutExpired):
        status["phase"] = "failed"
        status["detail"] = "systemctl reboot could not be started"
        append_event(status, "The restart command could not be started")
        save_status(status)


def startup_transition(status: dict):
    current_boot = boot_id()
    if status.get("phase") in {"rebooting", "pre_reboot"} and status.get("boot_id") not in {None, current_boot}:
        status["phase"] = "online"
        status["online_at"] = timestamp()
        status["boot_id"] = current_boot
        status["reboot_required"] = REBOOT_MARKER.exists()
        append_event(status, "The host is back online after the confirmed restart")
    elif not status.get("boot_id"):
        status["boot_id"] = current_boot
    return status


BOT_STATUS_FIELDS = {
    "requested_version",
    "current_version",
    "previous_version",
    "asset_name",
    "asset_url",
    "asset_digest",
    "rollback_source",
    "rollback_images",
    "rollback_available",
    "automatic",
}


def looks_like_bot_status(status: dict, bot_status: dict | None = None) -> bool:
    """Recognise a release snapshot left in the host status file by old builds."""
    if not isinstance(status, dict) or not status:
        return False
    if status.get("kind") == "bot":
        return True
    if any(field in status for field in BOT_STATUS_FIELDS):
        return True
    if status.get("kind") == "host":
        return False
    return bool(
        status.get("job_id")
        and isinstance(bot_status, dict)
        and status.get("job_id") == bot_status.get("job_id")
        and status.get("phase") in {"checking", "downloading", "verifying", "staging", "building", "restarting", "verifying_runtime"}
    )


def main():
    MAINTENANCE_DIR.mkdir(parents=True, exist_ok=True)
    raw_host_status = read_json(STATUS_FILE)
    raw_bot_status = read_bot_status()
    # Builds before the status split wrote bot-release progress into the host
    # snapshot. Do not let that stale record masquerade as the host OS or a
    # host restart; the separate bot status file remains the source of truth.
    if looks_like_bot_status(raw_host_status, raw_bot_status):
        status = base_status()
    else:
        status = startup_transition(base_status(raw_host_status))
    try:
        status.update(host_update_snapshot())
    except Exception:
        pass
    save_status(status)
    bot_status = base_bot_status(raw_bot_status)
    bot_status["update_supported"] = bot_update_supported()
    if bot_status.get("phase") in {"checking", "downloading", "verifying", "staging", "building", "restarting", "verifying_runtime"}:
        bot_status["phase"] = "failed"
        bot_status["detail"] = "The maintenance bridge restarted during a bot release action; the action was not resumed"
        append_bot_event(bot_status, "Bot release action interrupted by bridge restart")
    write_bot_status(bot_status)
    last_status_refresh = time.monotonic()
    while True:
        request = read_json(REQUEST_FILE)
        if request:
            try:
                REQUEST_FILE.unlink()
            except OSError:
                pass
            action = request.get("action")
            if action == "apply_updates":
                apply_updates(request)
            elif action == "reboot":
                request_reboot(request)
            elif action == "bot_update":
                if request.get("manual_confirmation") is True:
                    run_bot_update(request)
                else:
                    bot_status = base_bot_status(read_bot_status())
                    bot_status["phase"] = "failed"
                    bot_status["detail"] = "Bot release refused because an administrator confirmation marker was missing"
                    append_bot_event(bot_status, "Automatic bot release request refused")
                    write_bot_status(bot_status)
            elif action == "bot_rollback":
                if request.get("manual_confirmation") is True:
                    run_bot_rollback(request)
                else:
                    bot_status = base_bot_status(read_bot_status())
                    bot_status["phase"] = "failed"
                    bot_status["detail"] = "Bot rollback refused because an administrator confirmation marker was missing"
                    append_bot_event(bot_status, "Automatic bot rollback request refused")
                    write_bot_status(bot_status)
            elif action in {"bot_restart", "bot_repair", "settings_reset", "settings_restore"}:
                if request.get("manual_confirmation") is True:
                    run_bot_maintenance(request)
                else:
                    bot_status = base_bot_status(read_bot_status())
                    bot_status["phase"] = "failed"
                    bot_status["detail"] = "Bot maintenance refused because an administrator confirmation marker was missing"
                    append_bot_event(bot_status, "Automatic bot maintenance request refused")
                    write_bot_status(bot_status)
            else:
                status = base_status(read_json(STATUS_FILE))
                status["phase"] = "failed"
                status["detail"] = "Unknown maintenance action refused"
                append_event(status, "Unknown maintenance action refused")
                save_status(status)
        if time.monotonic() - last_status_refresh >= STATUS_INTERVAL_SECONDS:
            status = base_status(read_json(STATUS_FILE))
            if status.get("phase") in {"idle", "complete", "online"}:
                status.update(host_update_snapshot())
                status["reboot_required"] = REBOOT_MARKER.exists()
                save_status(status)
            last_status_refresh = time.monotonic()
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
