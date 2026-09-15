#!/usr/bin/env python3
"""Fail closed when the Runtipi app metadata and image release drift apart.

Runtipi keeps a generated Compose file on the host.  The source app payload is
the safe place to review and publish, so this check deliberately validates only
the tracked payload and never reads an operator's app-data or environment.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import NoReturn


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "app" / "config.json"
COMPOSE_PATH = ROOT / "app" / "docker-compose.yml"
VERSION_RE = re.compile(
    r"(?:0|[1-9][0-9]*)\."
    r"(?:0|[1-9][0-9]*)\."
    r"(?:0|[1-9][0-9]*)"
    r"(?:[a-z]|-[0-9A-Za-z.-]+)?$",
    re.IGNORECASE,
)


def fail(message: str) -> "NoReturn":
    print(f"Runtipi app validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    try:
        config = json.loads(CONFIG_PATH.read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read {CONFIG_PATH}: {error}")

    version = str(config.get("version", "")).strip()
    if not VERSION_RE.fullmatch(version):
        fail(f"app/config.json has an unsupported version: {version!r}")
    if not isinstance(config.get("force_pull"), bool):
        fail("app/config.json must declare force_pull as a boolean")
    if not isinstance(config.get("tipi_version"), int) or config["tipi_version"] < 1:
        fail("app/config.json must declare a supported tipi_version")

    try:
        compose = COMPOSE_PATH.read_text()
    except OSError as error:
        fail(f"cannot read {COMPOSE_PATH}: {error}")

    for component in ("AGENT", "BOT"):
        image_pattern = re.compile(
            rf"image:\s*\$\{{HOMELAB_CONTROL_{component}_IMAGE:-([^}}]+)\}}"
        )
        match = image_pattern.search(compose)
        if not match:
            fail(f"missing versioned {component.lower()} image default")
        expected = f"ghcr.io/twentylines/dc-homelab-control-{component.lower()}:{version}"
        if match.group(1) != expected:
            fail(
                f"{component.lower()} image default is {match.group(1)!r}; "
                f"it must be {expected!r}"
            )

    version_default = f"HOMELAB_CONTROL_VERSION: ${{HOMELAB_CONTROL_VERSION:-{version}}}"
    if compose.count(version_default) != 2:
        fail("agent and bot must both default HOMELAB_CONTROL_VERSION to the app version")
    if re.search(r"ghcr\.io/[^\s:]+/[^\s:]+:(?:latest|main)(?:\s|$)", compose):
        fail("Runtipi images must use immutable version tags, never latest or main")

    print(f"Runtipi app metadata and image tags are consistent for v{version}")
    return 0


if __name__ == "__main__":
    main()
