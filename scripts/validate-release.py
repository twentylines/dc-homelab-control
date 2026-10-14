#!/usr/bin/env python3
"""Check one release identity across Python, legacy OTA markers and Compose."""
import ast
import json
import re
import sys
import tomllib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
project = tomllib.loads((root / "bot/pyproject.toml").read_text())
version = sys.argv[1] if len(sys.argv) > 1 else project["project"]["version"]
if not re.fullmatch(r"\d+\.\d+\.\d+(?:[a-z]|-[0-9A-Za-z.-]+)?", version):
    raise SystemExit("Unsupported release version")
lock = json.loads((root / "bot/package-lock.json").read_text())
versions = {
    "Python project": project["project"]["version"],
    "Python runtime": ast.literal_eval((root / "bot/homelab_bot/__init__.py").read_text().split("__version__ = ")[1].strip()),
    "Runtipi": json.loads((root / "app/config.json").read_text())["version"],
    "Legacy package marker": json.loads((root / "bot/package.json").read_text())["version"],
    "Legacy lock marker": lock["version"],
    "Legacy root marker": lock["packages"][""]["version"],
}
for label, observed in versions.items():
    if observed != version:
        raise SystemExit(f"{label} is {observed}, expected {version}")
checks = {
    "agent/agent.py": f'os.getenv("HOMELAB_CONTROL_VERSION", "{version}").strip() or "{version}"',
    "config.example.env": f"HOMELAB_CONTROL_VERSION={version}",
    "compose.local.yml": "HOMELAB_CONTROL_VERSION: ${HOMELAB_CONTROL_VERSION:-" + version + "}",
    "app/docker-compose.yml": "HOMELAB_CONTROL_VERSION: ${HOMELAB_CONTROL_VERSION:-" + version + "}",
}
for path, text in checks.items():
    if text not in (root / path).read_text():
        raise SystemExit(f"Version default missing in {path}")
if not re.search(r"^## " + re.escape(version) + r"(?:\s|$)", (root / "CHANGELOG.md").read_text(), re.M):
    raise SystemExit("Release changelog missing")
if list((root / "bot/homelab_bot").glob("*.js")) or list((root / "bot/src").glob("*.js")):
    raise SystemExit("Legacy executable JavaScript remains in the bot")
print(f"Release identity consistent for v{version}")
