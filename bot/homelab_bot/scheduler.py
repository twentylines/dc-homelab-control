from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import aiohttp

from .api import optional, safe_error
from .state import now_iso, read_json, write_json

log = logging.getLogger(__name__)
VERSION = re.compile(
    r"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:([a-z])|-([0-9a-z.-]+))?$", re.I
)
ACTIVE = {
    "queued",
    "checking",
    "downloading",
    "verifying",
    "staging",
    "building",
    "restarting",
    "verifying_runtime",
}


def version_parts(value):
    match = VERSION.fullmatch(str(value or ""))
    if not match:
        return None
    a, b, c, suffix, pre = match.groups()
    return (int(a), int(b), int(c)), (suffix or "").lower(), (pre or "").lower()


def version_key(value):
    parts = version_parts(value)
    if parts is None:
        raise ValueError("Invalid release version")
    core, suffix, pre = parts
    tokens = tuple((0, int(v)) if v.isdigit() else (1, v) for v in pre.split(".")) if pre else ()
    return core, 2 if suffix else 0 if pre else 1, suffix, tokens


def allowed_release(release, settings, when):
    if not all(release.get(k) for k in ("update_available", "asset_verified", "update_supported")):
        return False
    current, latest = version_parts(release.get("current")), version_parts(release.get("latest"))
    if (
        not current
        or not latest
        or version_key(release["latest"]) <= version_key(release["current"])
    ):
        return False
    mode = settings["autoUpdateMode"]
    if settings["releaseChannel"] == "beta":
        return settings["betaAutoUpdateConfirmed"] is True
    if latest[2]:
        return False
    hotfix = bool(latest[1] and current[0] == latest[0] and not current[2])
    if mode == "hotfix":
        return hotfix
    if mode == "weekly":
        return hotfix or when.weekday() == 6
    return mode == "daily"


class Scheduler:
    def __init__(self, controller):
        self.controller = controller
        self.path = controller.cfg.data_dir / "weekly-report-state.json"
        self.busy = False

    def webhook(self):
        cfg = self.controller.cfg
        value = cfg.get("WEEKLY_REPORT_WEBHOOK_URL")
        if not value:
            path = Path(
                cfg.get("WEEKLY_REPORT_WEBHOOK_FILE", "/run/secrets/weekly-report/webhook.url")
            )
            if path.is_file():
                value = path.read_text().strip()
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or url.netloc != "discord.com"
            or url.query
            or url.fragment
            or not re.fullmatch(r"/api/webhooks/\d+/[A-Za-z0-9._-]+", url.path)
        ):
            return None
        return value

    async def post(self, embed):
        url = self.webhook()
        if not url:
            return False
        try:
            async with self.controller.session.post(
                url,
                json={
                    "username": self.controller.cfg.bot_name,
                    "embeds": [embed.to_dict()],
                    "allowed_mentions": {"parse": []},
                },
                timeout=aiohttp.ClientTimeout(total=15),
                allow_redirects=False,
            ) as response:
                return response.status in {200, 204}
        except (TimeoutError, aiohttp.ClientError):
            return False

    async def weekly(self):
        agent, settings = self.controller.agent, self.controller.settings.read()
        data, services, media, host, updates, summary = await asyncio.gather(
            agent.get("status"),
            agent.get("services"),
            agent.get("media"),
            optional(agent.get("system-updates", True)),
            optional(agent.get("updates", True, settings["releaseChannel"])),
            optional(agent.get("media-summary")),
        )
        return await self.post(
            self.controller.ui.weekly(data, services, media, host, updates, summary)
        )

    async def tick(self, when=None):
        if self.busy:
            return
        self.busy = True
        try:
            cfg, settings = self.controller.cfg, self.controller.settings.read()
            when = when or datetime.now(ZoneInfo(cfg.get("TIME_ZONE", "UTC")))
            state = read_json(self.path)
            date = when.strftime("%Y-%m-%d")
            pending = state.get("pendingAutoUpdate")
            snapshot = None
            if pending:
                snapshot = await self.controller.agent.get(
                    "updates", True, settings["releaseChannel"]
                )
                release = snapshot.get("bot") or {}
                if (
                    release.get("job_id") == pending.get("job_id")
                    and release.get("automatic") is True
                    and release.get("phase") in {"complete", "failed"}
                ):
                    if release["phase"] == "complete" and release.get("current") == pending.get(
                        "requested_version"
                    ):
                        self.controller.settings.update(
                            postUpdateNotice={
                                "version": release["current"],
                                "previous": pending.get("previous"),
                                "at": now_iso(),
                            }
                        )
                        state["lastAutoCompletion"] = pending["key"]
                    else:
                        state["lastAutoFailure"] = pending["key"]
                    state["pendingAutoUpdate"] = None
                    write_json(self.path, state)
            beta = (
                settings["releaseChannel"] == "beta" and settings["betaAutoUpdateConfirmed"] is True
            )
            due = (
                (settings["autoUpdateMode"] != "off" or beta)
                and when.hour == settings["autoUpdateHour"]
                and when.minute < 10
            )
            if due and not state.get("pendingAutoUpdate"):
                snapshot = snapshot or await self.controller.agent.get(
                    "updates", True, settings["releaseChannel"]
                )
                release = snapshot.get("bot") or {}
                key = f"{date}:{settings['autoUpdateMode']}:{settings['releaseChannel']}:{release.get('latest')}"
                if (
                    key not in {state.get("lastAutoAttempt"), state.get("lastAutoCompletion")}
                    and release.get("phase") not in ACTIVE
                    and allowed_release(release, settings, when)
                ):
                    state["lastAutoAttempt"] = key
                    write_json(self.path, state)
                    from types import SimpleNamespace

                    accepted = await self.controller.agent.post(
                        "bot-release/update",
                        SimpleNamespace(id="automatic", name="scheduled update"),
                        {
                            "automatic": True,
                            "channel": settings["releaseChannel"],
                            "beta_auto_update_confirmed": settings["betaAutoUpdateConfirmed"],
                        },
                    )
                    state["pendingAutoUpdate"] = {
                        "key": key,
                        "job_id": accepted.get("job_id"),
                        "requested_version": release.get("latest"),
                        "previous": release.get("current"),
                    }
                    write_json(self.path, state)
            if (
                cfg.get("WEEKLY_REPORT_ENABLED").lower() != "false"
                and when.weekday() == 6
                and when.hour == 20
                and when.minute < 5
                and state.get("lastWeeklyReport") != date
            ):
                if await self.weekly():
                    state["lastWeeklyReport"] = date
                    write_json(self.path, state)
            host = await optional(self.controller.agent.get("system-updates"))
            if (
                host
                and host.get("phase") == "online"
                and not self.controller.recovery.path("host").exists()
            ):
                key = f"{host.get('job_id', 'unknown')}:{host.get('boot_id', 'unknown')}"
                previous = read_json(cfg.data_dir / "host-reboot-last-online.json")
                if key not in {state.get("lastOnline"), previous.get("key")} and await self.post(
                    self.controller.ui.embed(
                        "Host back online", "The host bridge confirmed the new boot.", kind="ok"
                    )
                ):
                    state["lastOnline"] = key
                    write_json(self.path, state)
        except (ValueError, OSError) as exc:
            log.warning("Scheduled check needs attention: %s", safe_error(exc))
        finally:
            self.busy = False

    async def run(self):
        while True:
            await self.tick()
            await asyncio.sleep(30)
