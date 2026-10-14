from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from .config import Config


def now_iso():
    return datetime.now(UTC).isoformat()


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {} if default is None else default


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "w") as out:
            json.dump(value, out, ensure_ascii=False)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        Path(temporary).unlink(missing_ok=True)


def ids(values):
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(str(v) for v in values if re.fullmatch(r"\d{15,25}", str(v))))[:100]


class Settings:
    identity_env = {
        "adminUserIds": "DISCORD_ADMIN_USER_IDS",
        "guestUserIds": "DISCORD_GUEST_USER_IDS",
        "superuserIds": "DISCORD_SUPERUSER_IDS",
    }

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.path = Path(
            cfg.get("HOMELAB_CONTROL_SETTINGS_FILE", str(cfg.data_dir / "settings.json"))
        )

    def normalise(self, raw):
        if not isinstance(raw, dict):
            raise ValueError("Settings must be a JSON object")
        cfg = self.cfg
        result = {"version": 1}
        for kind, env in self.identity_env.items():
            disabled = "disabled" + kind[0].upper() + kind[1:]
            deny = ids(raw.get(disabled, []))
            configured = cfg.ids(env)
            if kind == "superuserIds":
                configured.append(cfg.get("DISCORD_OWNER_ID"))
                deny = [i for i in deny if i != cfg.get("DISCORD_OWNER_ID")]
            result[disabled] = deny
            result[kind] = [
                i for i in dict.fromkeys(configured + ids(raw.get(kind, []))) if i not in deny
            ]
        for key, env, default, allowed in (
            ("serviceControlMode", "SERVICE_CONTROL_MODE", "opt-out", {"opt-in", "opt-out"}),
            ("releaseChannel", "HOMELAB_CONTROL_RELEASE_CHANNEL", "stable", {"stable", "beta"}),
            (
                "autoUpdateMode",
                "HOMELAB_CONTROL_AUTO_UPDATE_MODE",
                "off",
                {"off", "daily", "weekly", "hotfix"},
            ),
        ):
            value = raw.get(key, cfg.get(env, default))
            result[key] = value if value in allowed else default
        result["betaAutoUpdateConfirmed"] = raw.get("betaAutoUpdateConfirmed") is True
        hour = raw.get("autoUpdateHour", cfg.integer("HOMELAB_CONTROL_AUTO_UPDATE_HOUR", 4, 0, 23))
        result["autoUpdateHour"] = hour if type(hour) is int and 0 <= hour <= 23 else 4
        notice = raw.get("postUpdateNotice")
        result["postUpdateNotice"] = notice if isinstance(notice, dict) else None
        result["updatedAt"] = raw.get("updatedAt")
        return result

    def read(self):
        try:
            return self.normalise(read_json(self.path))
        except (json.JSONDecodeError, ValueError) as exc:
            # Do not restore environment grants after a damaged deny-list.
            raise ValueError(
                "Saved settings cannot be read. Restore the settings backup before using controls."
            ) from exc

    def update(self, **patch):
        value = self.normalise({**self.read(), **patch, "updatedAt": now_iso()})
        write_json(self.path, value)
        return value

    def identity(self, kind, identity, remove=False):
        if kind not in self.identity_env or not re.fullmatch(r"\d{15,25}", identity):
            raise ValueError("Enter a Discord user ID (15 to 25 digits)")
        if remove and identity == self.cfg.get("DISCORD_OWNER_ID") and kind == "superuserIds":
            raise ValueError("The configured owner cannot be removed")
        state = self.read()
        disabled = "disabled" + kind[0].upper() + kind[1:]
        if remove:
            state[kind] = [i for i in state[kind] if i != identity]
            state[disabled] = list(dict.fromkeys(state[disabled] + [identity]))
        else:
            state[kind] = list(dict.fromkeys(state[kind] + [identity]))
            state[disabled] = [i for i in state[disabled] if i != identity]
        return self.update(**state)

    def access(self, interaction):
        if not interaction.guild_id or str(interaction.guild_id) not in self.cfg.guild_ids:
            return "none"
        user_id = str(interaction.user.id)
        if user_id == self.cfg.get("DISCORD_OWNER_ID"):
            return "superuser"
        state = self.read()
        roles = {str(role.id) for role in getattr(interaction.user, "roles", [])}
        if user_id in state["superuserIds"]:
            return "superuser"
        if user_id in state["adminUserIds"] or roles.intersection(
            self.cfg.ids("DISCORD_ADMIN_ROLE_IDS") + self.cfg.ids("DISCORD_ADMIN_ROLE_ID")
        ):
            return "admin"
        if user_id in state["guestUserIds"] or roles.intersection(
            self.cfg.ids("DISCORD_GUEST_ROLE_IDS")
        ):
            return "guest"
        return "none"

    def consume_notice(self):
        notice = self.read()["postUpdateNotice"]
        if notice:
            self.update(postUpdateNotice=None)
        return notice
