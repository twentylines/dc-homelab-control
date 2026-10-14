from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def load_env(path: Path, env: dict[str, str]) -> None:
    try:
        lines = path.read_text().splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if not env.get(key):
            env[key] = value


@dataclass(frozen=True)
class Config:
    values: dict[str, str] = field(repr=False)

    @classmethod
    def load(cls, environ=None):
        env = dict(os.environ if environ is None else environ)
        load_env(Path(env.get("HOMELAB_CONTROL_CONFIG_FILE") or "/data/config.env"), env)
        cfg = cls(env)
        for key in ("DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID", "DISCORD_OWNER_ID"):
            if not cfg.get(key):
                raise ValueError(f"Missing required setting: {key}")
        for key in ("DISCORD_CLIENT_ID", "DISCORD_GUILD_ID", "DISCORD_OWNER_ID"):
            if not re.fullmatch(r"\d{15,25}", cfg.get(key)):
                raise ValueError(f"{key} must be a Discord ID")
        if len(cfg.control_token) < 32:
            raise ValueError("The internal controller token is invalid")
        for key, allowed, default in (
            ("SERVICE_CONTROL_MODE", {"opt-in", "opt-out"}, "opt-out"),
            ("HOMELAB_CONTROL_RELEASE_CHANNEL", {"stable", "beta"}, "stable"),
            ("HOMELAB_CONTROL_AUTO_UPDATE_MODE", {"off", "daily", "weekly", "hotfix"}, "off"),
            (
                "MINECRAFT_BACKEND",
                {"auto", "none", "docker", "crafty", "pterodactyl", "pelican"},
                "auto",
            ),
        ):
            if cfg.get(key, default).lower() not in allowed:
                raise ValueError(f"Invalid setting: {key}")
        url = urlsplit(cfg.agent_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise ValueError("HOMELAB_CONTROL_AGENT_URL must be an HTTP(S) base URL")
        try:
            ZoneInfo(cfg.get("TIME_ZONE", "UTC"))
        except ZoneInfoNotFoundError as exc:
            raise ValueError("TIME_ZONE is not recognised") from exc
        cfg.integer("HEALTH_PORT", 3000, 1, 65535)
        cfg.integer("HOMELAB_CONTROL_AUTO_UPDATE_HOUR", 4, 0, 23)
        return cfg

    def get(self, key: str, default: str = "") -> str:
        return str(self.values.get(key) or default).strip()

    def ids(self, key: str) -> list[str]:
        return list(
            dict.fromkeys(
                v.strip() for v in self.get(key).split(",") if re.fullmatch(r"\d{15,25}", v.strip())
            )
        )

    def integer(self, key, default, minimum, maximum):
        try:
            value = int(self.get(key, str(default)))
        except ValueError as exc:
            raise ValueError(f"{key} must be an integer") from exc
        if not minimum <= value <= maximum:
            raise ValueError(f"{key} is out of range")
        return value

    @property
    def control_token(self):
        path = Path(self.get("CONTROL_TOKEN_FILE", "/run/secrets/control-token"))
        return path.read_text().strip() if path.is_file() else self.get("CONTROL_TOKEN")

    @property
    def agent_url(self):
        return self.get("HOMELAB_CONTROL_AGENT_URL", "http://agent:8787").rstrip("/")

    @property
    def guild_ids(self):
        return list(dict.fromkeys([self.get("DISCORD_GUILD_ID"), *self.ids("DISCORD_GUILD_IDS")]))

    @property
    def data_dir(self):
        return Path(self.get("BOT_DATA_DIR", "/data"))

    @property
    def bot_name(self):
        return " ".join(self.get("BOT_NAME", "Homelab Control").split())[:80]
