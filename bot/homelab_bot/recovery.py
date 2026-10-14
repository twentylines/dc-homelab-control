from __future__ import annotations

import asyncio
import logging
import time

from .state import read_json, write_json
from .ui import Panel, navigation

log = logging.getLogger(__name__)
FILES = {
    "release": "bot-release-interaction.json",
    "maintenance": "bot-maintenance-interaction.json",
    "host": "host-reboot-interaction.json",
}
TERMINAL = {
    "release": {"complete", "rolled_back", "failed"},
    "maintenance": {"complete", "failed"},
    "host": {"online", "failed"},
}


class Recovery:
    def __init__(self, controller):
        self.controller = controller
        self.running = set()

    def path(self, kind):
        return self.controller.cfg.data_dir / FILES[kind]

    def stage(self, kind, interaction, action, target=None, job_id=""):
        timestamp = int(time.time() * 1000)
        state = {
            "schema": 1,
            "application_id": str(interaction.application_id),
            "interaction_token": interaction.token,
            "action": action,
            "target": target,
            "job_id": job_id,
            "created_at": timestamp,
            "expires_at": timestamp + 14 * 60 * 1000,
        }
        write_json(self.path(kind), state)
        return state

    def accepted(self, kind, accepted):
        state = read_json(self.path(kind))
        state["job_id"] = str(accepted.get("job_id") or state.get("job_id") or "")
        state["target"] = (
            accepted.get("version")
            or accepted.get("requested_version")
            or accepted.get("latest")
            or state.get("target")
        )
        write_json(self.path(kind), state)

    def clear(self, kind):
        self.path(kind).unlink(missing_ok=True)

    def panel(self, kind, action, status):
        phase = str(status.get("phase") or "queued").lower()
        complete = phase in TERMINAL[kind] - {"failed"}
        failed = phase == "failed"
        title = (
            "Host restart"
            if kind == "host"
            else "Bot rollback"
            if action == "rollback"
            else "Bot update"
            if kind == "release"
            else "Bot maintenance"
        )
        if complete:
            text = "**Complete**\n" + (
                "The host returned after restart."
                if kind == "host"
                else "Both control services passed the host bridge's health checks."
            )
        elif failed:
            text = "**Action needs attention**\n" + str(
                status.get("detail") or "Open Updates for the current job status."
            )
        elif phase in {"restarting", "verifying_runtime", "rebooting"}:
            text = "◓ **Restarting**\nThis may take a few minutes. This message will be updated after the replacement services return."
        else:
            text = "◓ **" + phase.replace("_", " ").title() + "**\nWaiting for the host bridge."
        version = status.get("current") or status.get("requested_version")
        if version:
            text += "\nVersion · **" + str(version)[:40] + "**"
        embed = self.controller.ui.embed(
            title,
            text,
            kind="bad" if failed else "ok" if complete else "warn",
            tip="Open Updates for the current job status",
        )
        events = status.get("events") or []
        if events:
            from .api import safe_error
            from .ui import field

            field(
                embed,
                "Recent activity",
                "\n".join(
                    safe_error(e.get("message") or e.get("detail") or str(e))
                    if isinstance(e, dict)
                    else safe_error(e)
                    for e in events[-4:]
                ),
            )
        return Panel([embed], navigation("updates") if complete or failed else [])

    async def edit(self, state, panel):
        if time.time() * 1000 >= state.get("expires_at", 0):
            return False
        # Preserve legacy button IDs so the post-restart message is navigable.
        components = (
            [
                {
                    "type": 1,
                    "components": [
                        {
                            "type": 2,
                            "style": 2,
                            "custom_id": "nav:updates",
                            "label": "Back to updates",
                        },
                        {"type": 2, "style": 2, "custom_id": "nav:panel", "label": "Back to home"},
                    ],
                }
            ]
            if panel.controls
            else []
        )
        url = f"https://discord.com/api/v10/webhooks/{state['application_id']}/{state['interaction_token']}/messages/@original"
        import aiohttp

        try:
            async with self.controller.session.patch(
                url,
                json={
                    "embeds": [e.to_dict() for e in panel.embeds],
                    "components": components,
                    "allowed_mentions": {"parse": []},
                },
                timeout=aiohttp.ClientTimeout(total=15),
                allow_redirects=False,
            ) as response:
                return response.status == 200
        except (TimeoutError, aiohttp.ClientError):
            return False

    async def resume_all(self):
        await asyncio.gather(*(self.resume(kind) for kind in FILES))

    async def resume(self, kind):
        if kind in self.running:
            return
        path = self.path(kind)
        if not path.exists():
            return
        try:
            state = read_json(path)
            import re

            if (
                not isinstance(state, dict)
                or not re.fullmatch(r"\d{15,25}", str(state.get("application_id", "")))
                or not re.fullmatch(
                    r"[A-Za-z0-9._-]{40,400}", str(state.get("interaction_token", ""))
                )
            ):
                self.clear(kind)
                return
        except (ValueError, OSError):
            log.warning("Invalid private recovery state; no webhook was called")
            return
        self.running.add(kind)
        try:
            status = {
                "phase": "rebooting" if kind == "host" else "restarting",
                "requested_version": state.get("target"),
            }
            while time.time() * 1000 < state.get("expires_at", 0):
                try:
                    if kind == "host":
                        status = await self.controller.agent.get("system-updates", True)
                    else:
                        snapshot = await self.controller.agent.get(
                            "updates", True, self.controller.settings.read()["releaseChannel"]
                        )
                        status = snapshot.get("bot") or {}
                    # A missing job ID must never turn an unrelated old completion into success.
                    same_job = bool(state.get("job_id") and status.get("job_id") == state["job_id"])
                    phase = str(status.get("phase", "")).lower()
                    if same_job and phase in TERMINAL[kind]:
                        if (
                            kind == "release"
                            and phase != "failed"
                            and state.get("target")
                            and status.get("current") != state["target"]
                        ):
                            status = {
                                **status,
                                "phase": "failed",
                                "detail": "The reported runtime version does not match the requested release.",
                            }
                        break
                    await self.edit(
                        state,
                        self.panel(
                            kind,
                            state.get("action"),
                            {**status, "phase": phase if same_job else "restarting"},
                        ),
                    )
                except (ValueError, OSError):
                    pass
                await asyncio.sleep(4)
            else:
                status = {
                    **status,
                    "phase": "failed",
                    "detail": "The Discord interaction expired before completion was verified. Open /updates for the current state.",
                }
            panel = self.panel(kind, state.get("action"), status)
            edited = await self.edit(state, panel)
            if not edited and getattr(self.controller, "scheduler", None):
                await self.controller.scheduler.post(panel.embeds[0])
            if kind == "host" and status.get("phase") == "online":
                write_json(
                    self.controller.cfg.data_dir / "host-reboot-last-online.json",
                    {
                        "key": f"{status.get('job_id', 'unknown')}:{status.get('boot_id', 'unknown')}"
                    },
                )
            self.clear(kind)
        finally:
            self.running.discard(kind)
