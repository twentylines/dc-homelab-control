from __future__ import annotations

import asyncio
import logging
import math
import time
from urllib.parse import quote

import discord

from .api import optional, safe_error
from .recovery import Recovery
from .ui import Control, Panel, clean, field, navigation, os_name, size
from .views import Confirmation, InputModal, PanelView
from .wake import Wake

log = logging.getLogger(__name__)


class Controller:
    def __init__(self, cfg, settings, agent, minecraft, renderer, session):
        self.cfg, self.settings, self.agent, self.minecraft, self.ui, self.session = (
            cfg,
            settings,
            agent,
            minecraft,
            renderer,
            session,
        )
        self.recovery, self.wake = Recovery(self), Wake(cfg)
        self.live, self.background, self.revisions = {}, set(), {}
        self.active_views = set()
        self.scheduler = None

    def spawn(self, coro):
        task = asyncio.create_task(coro)
        self.background.add(task)
        task.add_done_callback(self.background.discard)

        def completed(result):
            if not result.cancelled() and result.exception():
                log.error("Background workflow failed: %s", safe_error(result.exception()))

        task.add_done_callback(completed)
        return task

    def require(self, interaction, *, superuser=False):
        level = self.settings.access(interaction)
        if (
            level == "none"
            or (superuser and level != "superuser")
            or (not superuser and level not in {"admin", "superuser"})
        ):
            raise ValueError(
                "Superuser access is required"
                if superuser
                else "Administrator access is required for this action"
            )

    async def fail(self, interaction, error):
        panel = self.ui.error(error)
        try:
            if interaction.response.is_done():
                await interaction.edit_original_response(
                    embeds=panel.embeds, view=PanelView(self, panel.controls)
                )
            else:
                await interaction.response.send_message(
                    embeds=panel.embeds, view=PanelView(self, panel.controls), ephemeral=True
                )
        except discord.HTTPException:
            log.warning("Could not send the request error to Discord")

    def stop_live(self, message_id):
        task = self.live.pop(message_id, None)
        if task and task is not asyncio.current_task():
            task.cancel()

    async def close(self):
        tasks = list(self.background)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def payload(self, page, interaction, page_number=0):
        level = self.settings.access(interaction)
        if level == "none":
            raise ValueError("Access is restricted to the configured Discord users and roles")
        admin = level in {"admin", "superuser"}
        channel = self.settings.read()["releaseChannel"]
        if page in {"panel", "status", "health", "report"}:
            status = await self.agent.get("status")
            if page == "status":
                return self.ui.overview(page, status)
            services, media, updates, summary = await asyncio.gather(
                self.agent.get("services"),
                self.agent.get("media"),
                optional(self.agent.get("updates", False, channel)),
                optional(self.agent.get("media-summary")),
            )
            panel = self.ui.overview(page, status, services, media, updates, summary)
            if page == "report":
                host = await optional(self.agent.get("system-updates", True))
                panel.embeds[0].title = "Detailed homelab report"
                field(panel.embeds[0], "Software", self.ui.software(updates, host))
                detail = self.ui.services(services).embeds[0]
                panel.embeds.append(detail)
                panel.controls = navigation("report")
            if page == "panel":
                hidden = set()
                if not media:
                    hidden.add("media")
                if self.cfg.get("MINECRAFT_BACKEND", "auto") == "none":
                    hidden.add("minecraft")
                if not admin:
                    hidden.add("settings")
                panel.controls = [
                    control
                    for control in panel.controls
                    if control.key != "page" or control.value not in hidden
                ]
            return panel
        if page == "storage":
            return self.ui.storage(await self.agent.get("status"))
        if page in {"services", "controls"}:
            if page == "controls":
                policy = await self.agent.get("control-policy")
                return self.ui.services(policy.get("services", []), page_number, policy, admin)
            return self.ui.services(await self.agent.get("services"), page_number)
        if page == "tasks":
            return self.ui.tasks(await self.agent.get("tasks", True), page_number)
        if page == "minecraft":
            return self.ui.minecraft(await self.minecraft.servers(), admin=admin, page=page_number)
        if page == "media":
            values = await asyncio.gather(
                self.agent.get("media"),
                optional(self.agent.get("jellyfin")),
                optional(self.agent.get("plex")),
                optional(self.agent.get("status")),
                optional(self.agent.get("media-resources")),
                optional(self.agent.get("media-summary")),
            )
            return self.ui.media(*values)
        if page == "network":
            values = await asyncio.gather(
                self.agent.get("network"),
                optional(self.agent.get("network-summary")),
                optional(self.agent.get("status"), {}),
                optional(self.agent.get("network-connectivity")),
            )
            return self.ui.network(*values)
        if page == "updates":
            snapshot, host = await asyncio.gather(
                self.agent.get("updates", True, channel),
                optional(self.agent.get("system-updates", True), {"available": False}),
            )
            return self.ui.updates(snapshot, host, admin)
        if page == "help":
            e = self.ui.embed(
                "Command guide",
                "Most commands open a private panel. Use the public option to share a status view. Guests can inspect; administrators confirm changes.",
            )
            field(
                e,
                "Inspect",
                "`/panel` home · `/status` host · `/services` containers\n`/tasks` CPU and RAM · `/storage` drives\n`/media` playback · `/minecraft` servers · `/network` connectivity",
            )
            field(
                e,
                "Maintain",
                "`/updates` releases, host updates and rollback\n`/controls` enable or disable container controls\n`/settings` access, automatic updates and recovery",
            )
            field(
                e,
                "More",
                "`/health` summary · `/report` details · `/audit` actions\n`/ping` response timing · `/wake` Wake-on-LAN",
            )
            return Panel([e], navigation("help"))
        if page == "ping":
            start = time.monotonic()
            timing = await optional(self.agent.get("ping"))
            elapsed = (time.monotonic() - start) * 1000
            e = self.ui.embed(
                "Response time", tip="Controller timing includes the gateway/DNS probes"
            )
            latency = interaction.client.latency
            field(
                e,
                "Discord gateway heartbeat",
                f"{latency * 1000:.0f} ms" if math.isfinite(latency) else "Connecting",
                True,
            )
            field(e, "Controller round trip", f"{elapsed:.0f} ms", True)
            if timing:
                field(
                    e,
                    "Gateway probe",
                    str((timing.get("gateway") or {}).get("latency_ms", "Not reported")) + " ms",
                    True,
                )
            return Panel([e], navigation("ping"))
        if page == "audit":
            events = await self.agent.get("audit")
            text = "\n".join(
                f"**{clean(e.get('actor_name'))}** · {clean(e.get('action'))} {clean(e.get('service'))} · {clean(e.get('result'))}"
                for e in events[-15:][::-1]
            )
            return Panel(
                [self.ui.embed("Recent actions", text or "No actions recorded.")],
                navigation("audit"),
            )
        if page.startswith("settings"):
            self.require(interaction)
            return self.settings_panel(page, level)
        raise ValueError("That page is not available")

    def settings_panel(self, page, level):
        state = self.settings.read()
        category = page.partition("/")[2]
        e = self.ui.embed(
            "Settings" + (" · " + category.title() if category else ""),
            tip="Settings are saved for this installation",
        )
        controls = navigation("settings", "panel")
        if not category:
            e.description = "Choose the setting you want to change."
            controls.append(
                Control(
                    "Settings category",
                    "page",
                    options=[
                        ("Access", "settings/access", "Who can inspect and control the server"),
                        ("Updates", "settings/updates", "Channel and automatic install schedule"),
                        ("Container controls", "controls", "Enable or disable detected containers"),
                        (
                            "Recovery",
                            "settings/recovery",
                            "Restart, restore or repair the controller",
                        ),
                    ],
                )
            )
        elif category == "access":
            for kind, label in (
                ("superuserIds", "Superusers"),
                ("adminUserIds", "Administrators"),
                ("guestUserIds", "Read-only guests"),
            ):
                field(
                    e,
                    label,
                    "\n".join("`" + str(i) + "`" for i in state[kind]) or "None configured",
                    True,
                )
            if level == "superuser":
                for kind, label in (
                    ("adminUserIds", "Add administrator"),
                    ("guestUserIds", "Add guest"),
                    ("superuserIds", "Add superuser"),
                ):
                    controls.append(Control(label, "identity_add", kind))
                options = [
                    (
                        f"{kind.removesuffix('UserIds')} · {i}",
                        kind + ":" + i,
                        "Remove this access grant",
                    )
                    for kind in ("superuserIds", "adminUserIds", "guestUserIds")
                    for i in state[kind]
                    if i != self.cfg.get("DISCORD_OWNER_ID")
                ]
                if options:
                    controls.append(
                        Control("Remove an access grant", "identity_remove", options=options[:25])
                    )
        elif category == "updates":
            hour = state["autoUpdateHour"]
            channel = state["releaseChannel"]
            e.description = f"**{channel.title()} channel**\nAutomatic updates check and install verified bot releases at {hour:02d}:00 {self.cfg.get('TIME_ZONE', 'UTC')}."
            field(
                e,
                "Automatic updates",
                "**Off** · install manually\n**Daily hotfixes** · letter hotfixes for your current release\n**Daily checks** · stable releases and hotfixes daily\n**Weekly checks** · stable releases Sundays, hotfixes daily",
            )
            field(e, "Current schedule", state["autoUpdateMode"])
            if channel == "beta":
                field(
                    e,
                    "Beta live-patch route",
                    "Beta receives stable and beta releases. Automatic daily updates are required on this route. Choose Stable to return to manual updates.",
                )
            controls.append(
                Control(
                    "Release channel",
                    "channel",
                    options=[
                        ("Stable channel", "stable", "Stable releases and letter hotfixes"),
                        (
                            "Beta channel",
                            "beta",
                            "Stable and beta releases; daily automatic updates",
                        ),
                    ],
                )
            )
            if channel != "beta":
                controls.append(
                    Control(
                        "Automatic update schedule",
                        "auto_mode",
                        options=[
                            ("Off · manual updates", "off", "Install only after confirmation"),
                            (
                                "Daily hotfixes",
                                "hotfix",
                                "Check and install current-line letter hotfixes daily",
                            ),
                            (
                                "Daily checks",
                                "daily",
                                "Check and install stable releases and hotfixes daily",
                            ),
                            ("Weekly checks", "weekly", "Stable releases Sundays, hotfixes daily"),
                        ],
                    )
                )
        elif category == "recovery":
            e.description = "Recovery actions show a confirmation before changing anything. Settings backups stay on the server."
            for action, label in (
                ("restart", "Restart controller"),
                ("restore", "Restore settings backup"),
                ("fix-preserve", "Repair, keep settings"),
                ("reset", "Reset settings"),
            ):
                controls.append(Control(label, "maintenance", action))
            if level == "superuser":
                controls.append(
                    Control(
                        "Fresh reinstall", "maintenance", "fix-fresh", discord.ButtonStyle.danger
                    )
                )
        return Panel([e], controls)

    async def show(self, interaction, page, *, public=False, page_number=0, notice=False):
        try:
            if self.settings.access(interaction) == "none":
                raise ValueError("Access is restricted to configured users and roles")
        except (ValueError, OSError) as exc:
            await self.fail(interaction, exc)
            return
        message_id = getattr(getattr(interaction, "message", None), "id", interaction.id)
        self.stop_live(message_id)
        if len(self.revisions) > 2048:
            self.revisions.pop(next(iter(self.revisions)))
        revision = self.revisions.get(message_id, 0) + 1
        self.revisions[message_id] = revision
        if not interaction.response.is_done():
            await interaction.response.defer(
                ephemeral=not public, thinking=interaction.type != discord.InteractionType.component
            )
        try:
            if page not in {
                "help",
                "settings",
                "settings/access",
                "settings/updates",
                "settings/recovery",
            }:
                # Retain the last complete panel while only its footer refreshes.
                previous = None
                message = getattr(interaction, "message", None)
                if message and message.embeds:
                    previous = Panel(message.embeds)
                panel = await self.with_loading(
                    interaction,
                    page,
                    self.payload(page, interaction, page_number),
                    previous,
                    lambda: self.revisions.get(message_id) == revision,
                )
            else:
                panel = await self.payload(page, interaction, page_number)
            if self.revisions.get(message_id) != revision:
                return
            if notice:
                value = self.settings.consume_notice()
                if value:
                    panel.embeds.append(
                        self.ui.embed(
                            "Update complete",
                            "Running **"
                            + clean(value.get("version"))
                            + "** after the scheduled update.",
                            kind="ok",
                        )
                    )
            await interaction.edit_original_response(
                embeds=panel.fit().embeds, view=PanelView(self, panel.controls)
            )
        except (ValueError, discord.HTTPException, OSError) as exc:
            if self.revisions.get(message_id) == revision:
                await self.fail(interaction, exc)

    async def with_loading(self, interaction, page, operation, previous=None, alive=lambda: True):
        async def animate():
            tick = 0
            while alive():
                await interaction.edit_original_response(
                    embeds=self.ui.loading(page, tick, previous).embeds
                )
                tick += 1
                await asyncio.sleep(2)

        task = asyncio.create_task(animate())
        try:
            return await operation
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def confirm(self, interaction, action, title, description, notes=None):
        self.require(interaction, superuser=action.get("action") == "fix-fresh")
        e = self.ui.embed(
            title, description, kind="warn", tip="Confirmation expires after 60 seconds"
        )
        if notes:
            for index in range(0, min(len(notes), 3000), 1000):
                field(
                    e,
                    "Release notes" if not index else "Release notes continued",
                    notes[index : index + 1000],
                )
        panel = Panel([e])
        view = Confirmation(self, interaction.user.id, action, panel)
        if interaction.response.is_done():
            await interaction.edit_original_response(embeds=panel.embeds, view=view)
        else:
            await interaction.response.send_message(embeds=panel.embeds, view=view, ephemeral=True)

    async def release(self):
        return (await self.agent.get("updates", True, self.settings.read()["releaseChannel"])).get(
            "bot"
        ) or {}

    async def dispatch(self, interaction, key, value=None):
        try:
            if self.settings.access(interaction) == "none":
                raise ValueError("Access is restricted to configured users and roles")
            if key == "page":
                return await self.show(interaction, value)
            if key in {"tasks_page", "services_page", "controls_page", "mc_page"}:
                return await self.show(
                    interaction,
                    {
                        "tasks_page": "tasks",
                        "services_page": "services",
                        "controls_page": "controls",
                        "mc_page": "minecraft",
                    }[key],
                    page_number=int(value),
                )
            if key in {"identity_add", "mc_console"}:
                self.require(interaction, superuser=key == "identity_add")
                await interaction.response.send_modal(
                    InputModal(self, "console" if key == "mc_console" else "identity", value)
                )
                return
            # Acknowledge before API reads, so slow integrations cannot expire the click.
            private = key in {
                "logs",
                "bot_update",
                "rollback_version",
                "rollback_retained",
                "host_update",
                "host_reboot",
                "apps_update",
                "app_update",
                "maintenance",
                "service_action",
                "mc_action",
                "channel",
            }
            await interaction.response.defer(ephemeral=private, thinking=private)
            message_id = getattr(getattr(interaction, "message", None), "id", interaction.id)
            self.stop_live(message_id)
            admin = self.settings.access(interaction) in {"admin", "superuser"}
            panel = None
            if key in {"service_detail", "control_detail"}:
                rows = (
                    (await self.agent.get("control-policy")).get("services", [])
                    if key == "control_detail"
                    else await self.agent.get("services")
                )
                item = next((s for s in rows if s.get("key") == value), None)
                if not item:
                    raise ValueError("Container no longer exists. Refresh the list.")
                panel = self.ui.service_detail(item, admin, key == "control_detail")
            elif key == "logs":
                self.require(interaction)
                logs = await self.agent.logs(value)
                panel = Panel(
                    [
                        self.ui.embed(
                            "Recent logs",
                            "```text\n" + safe_error("\n".join(logs))[:3500] + "\n```",
                        )
                    ],
                    navigation("services"),
                )
            elif key in {"control_toggle", "control_mode"}:
                self.require(interaction)
                body = (
                    {"mode": value}
                    if key == "control_mode"
                    else {"key": value[0], "enabled": value[1]}
                )
                await self.agent.post("control-policy", interaction.user, body)
                if key == "control_mode":
                    self.settings.update(serviceControlMode=value)
                panel = await self.payload("controls", interaction)
            elif key == "identity_remove":
                self.require(interaction, superuser=True)
                kind, identity = value.split(":", 1)
                self.settings.identity(kind, identity, remove=True)
                panel = await self.payload("settings/access", interaction)
            elif key == "auto_mode":
                self.require(interaction)
                if value not in {"off", "daily", "weekly", "hotfix"}:
                    raise ValueError("Choose a valid automatic update schedule")
                if self.settings.read()["releaseChannel"] == "beta":
                    raise ValueError(
                        "Beta requires daily automatic updates. Choose Stable for manual schedules."
                    )
                self.settings.update(autoUpdateMode=value)
                panel = await self.payload("settings/updates", interaction)
            elif key == "channel":
                self.require(interaction)
                if value not in {"stable", "beta"}:
                    raise ValueError("Unknown release channel")
                if value == "beta":
                    return await self.confirm(
                        interaction,
                        {"type": "beta"},
                        "Join the Beta channel?",
                        "The beta live-patch route receives stable and beta releases and automatically installs verified updates daily. Confirm to enable this route; choose Stable later to disable it.",
                    )
                self.settings.update(
                    releaseChannel="stable", betaAutoUpdateConfirmed=False, autoUpdateMode="off"
                )
                panel = await self.payload("settings/updates", interaction)
            elif key == "task_detail":
                snapshot = await self.agent.get("tasks")
                task = next(
                    (s for s in snapshot.get("containers", []) if s.get("id") == value), None
                )
                if not task:
                    raise ValueError("That task is no longer running. Refresh the list.")
                panel = self.ui.task_detail(task)
            elif key in {"tasks_live", "tasks_stop"}:
                snapshot = await self.agent.get("tasks", key == "tasks_live")
                panel = self.ui.tasks(snapshot, live=key == "tasks_live")
                if key == "tasks_live":
                    # The new private response owns this live window.
                    message = await interaction.edit_original_response(
                        embeds=panel.embeds, view=PanelView(self, panel.controls)
                    )
                    self.live[message.id] = self.spawn(
                        self.live_tasks(interaction, message.id, snapshot)
                    )
                    return
            elif key == "mc_detail":
                server = next((s for s in await self.minecraft.servers() if s["id"] == value), None)
                if not server:
                    raise ValueError("Minecraft server no longer exists")
                panel = self.ui.minecraft([], server, admin)
            elif key in {"service_action", "mc_action"}:
                self.require(interaction)
                return await self.confirm(
                    interaction,
                    {
                        "type": "service" if key == "service_action" else "minecraft",
                        "id": value[0],
                        "action": value[1],
                    },
                    "Confirm " + value[1],
                    "Run **" + value[1] + "** on **" + clean(value[0]) + "**?",
                )
            elif key == "bot_update":
                self.require(interaction)
                release = await self.release()
                if not all(
                    release.get(k)
                    for k in ("update_available", "asset_verified", "update_supported")
                ):
                    raise ValueError(
                        "No installable verified release is available. Refresh Updates."
                    )
                return await self.confirm(
                    interaction,
                    {"type": "release", "action": "update", "target": release.get("latest")},
                    "Update bot to " + clean(release.get("latest")) + "?",
                    "**Download** "
                    + size(release.get("asset_size"))
                    + "\nThe controller restarts during installation and reports back after verification.",
                    notes=str(
                        release.get("release_notes")
                        or release.get("changelog")
                        or release.get("body")
                        or "No release notes supplied."
                    ),
                )
            elif key == "rollback":
                self.require(interaction)
                panel = self.ui.rollback(await self.release())
            elif key in {"rollback_version", "rollback_retained"}:
                self.require(interaction)
                release = await self.release()
                options = (
                    release.get("rollback_options") or release.get("github_rollback_options") or []
                )
                selected = next((o for o in options if o.get("version") == value), None)
                retained = key == "rollback_retained"
                if (
                    not release.get("update_supported")
                    or (
                        retained
                        and not (
                            release.get("rollback_available")
                            and release.get("rollback_source") == "local"
                        )
                    )
                    or (not retained and not selected)
                ):
                    raise ValueError("Rollback target is no longer available. Refresh the options.")
                target = release.get("rollback_version") if retained else value
                return await self.confirm(
                    interaction,
                    {
                        "type": "release",
                        "action": "rollback",
                        "target": target,
                        "selected_version": "" if retained else value,
                    },
                    "Rollback to " + clean(target or "retained legacy images") + "?",
                    "Only the owner-approved golden version is recommended. Other versions may be broken, obsolete or incompatible with current data.\n**Download** "
                    + ("Retained locally" if retained else size(selected.get("asset_size"))),
                )
            elif key in {"host_update", "host_reboot"}:
                self.require(interaction)
                host = await self.agent.get("system-updates", True)
                if key == "host_reboot" and (
                    host.get("phase") != "ready_for_reboot" or not host.get("reboot_required")
                ):
                    raise ValueError("Host is not waiting for a confirmed reboot")
                if key == "host_update" and (
                    not host.get("maintenance_available")
                    or host.get("update_supported") is False
                    or (host.get("pending_count") or 0) <= 0
                ):
                    raise ValueError("No supported host updates can be applied")
                return await self.confirm(
                    interaction,
                    {"type": key, "job_id": host.get("job_id")},
                    "Confirm "
                    + os_name(host)
                    + (" restart" if key == "host_reboot" else " updates"),
                    "Restart the host and report after the next boot?"
                    if key == "host_reboot"
                    else f"Apply {host['pending_count']} pending packages? A reboot requires a separate confirmation.",
                )
            elif key in {"apps_update", "app_update"}:
                self.require(interaction)
                return await self.confirm(
                    interaction,
                    {"type": "apps", "id": value if key == "app_update" else "all"},
                    "Confirm Runtipi updates",
                    "Request the normal Runtipi backup, then update and verify eligible apps one at a time. The controller remains protected.",
                )
            elif key == "maintenance":
                self.require(interaction, superuser=value == "fix-fresh")
                if value not in {"restart", "reset", "restore", "fix-preserve", "fix-fresh"}:
                    raise ValueError("Unsupported recovery action")
                return await self.confirm(
                    interaction,
                    {"type": "maintenance", "action": value},
                    "Confirm controller " + value,
                    "Back up settings and perform this recovery action?"
                    + (
                        " A fresh reinstall resets configuration; Discord must be configured again."
                        if value == "fix-fresh"
                        else " The controller will report its result after verification."
                    ),
                )
            else:
                raise ValueError("That control has expired. Open the command again.")
            if panel:
                await interaction.edit_original_response(
                    embeds=panel.embeds, view=PanelView(self, panel.controls)
                )
        except (ValueError, OSError, discord.HTTPException) as exc:
            await self.fail(interaction, exc)

    async def live_tasks(self, interaction, message_id, snapshot):
        deadline = time.monotonic() + 60
        try:
            while time.monotonic() < deadline:
                await asyncio.sleep(5)
                current = self.ui.tasks(snapshot, live=True)
                await interaction.edit_original_response(
                    embeds=self.ui.loading("tasks", previous=current).embeds
                )
                owner_task = asyncio.current_task()
                snapshot = await self.with_loading(
                    interaction,
                    "tasks",
                    self.agent.get("tasks", True),
                    current,
                    lambda: self.live.get(message_id) is owner_task,
                )
                if self.live.get(message_id) is not asyncio.current_task():
                    return
                current = self.ui.tasks(snapshot, live=True)
                await interaction.edit_original_response(
                    embeds=current.embeds, view=PanelView(self, current.controls)
                )
            current = self.ui.tasks(snapshot)
            await interaction.edit_original_response(
                embeds=current.embeds, view=PanelView(self, current.controls)
            )
        except (ValueError, discord.HTTPException):
            # Keep the last full snapshot; sampling errors must not blank it.
            current = self.ui.tasks(snapshot)
            current.embeds[0].set_footer(text="Live refresh stopped. Press Refresh to try again.")
            try:
                await interaction.edit_original_response(
                    embeds=current.embeds, view=PanelView(self, current.controls)
                )
            except discord.HTTPException:
                pass
        finally:
            if self.live.get(message_id) is asyncio.current_task():
                self.live.pop(message_id, None)

    async def execute(self, interaction, action):
        kind = action["type"]
        accepted = None
        recovery_kind = None
        try:
            self.require(interaction, superuser=action.get("action") == "fix-fresh")
            await interaction.response.defer()
            progress = self.ui.embed("Working", "◓ Waiting for the confirmed action to finish.")
            await interaction.edit_original_response(embeds=[progress], view=None)
            user = interaction.user
            if kind == "beta":
                self.settings.update(
                    releaseChannel="beta", betaAutoUpdateConfirmed=True, autoUpdateMode="daily"
                )
                return await self.show(interaction, "settings/updates")
            if kind in {"release", "maintenance", "host_reboot"}:
                recovery_kind = "host" if kind == "host_reboot" else kind
                self.recovery.stage(
                    recovery_kind,
                    interaction,
                    action.get("action", "restart"),
                    action.get("target"),
                    action.get("job_id", ""),
                )
                channel = self.settings.read()["releaseChannel"]
                if kind == "release":
                    if action["action"] == "update":
                        latest = await self.release()
                        if latest.get("latest") != action.get("target") or not all(
                            latest.get(k)
                            for k in ("asset_verified", "update_available", "update_supported")
                        ):
                            raise ValueError(
                                "The release changed after confirmation. Review the latest notes in Updates."
                            )
                    endpoint = "bot-release/" + action["action"]
                    body = {"channel": channel}
                    if action["action"] == "rollback":
                        body["selected_version"] = action.get("selected_version", "")
                    accepted = await self.agent.post(endpoint, user, body)
                elif kind == "maintenance":
                    name = action["action"]
                    endpoint = {
                        "restart": "bot-release/restart",
                        "reset": "settings/reset",
                        "restore": "settings/restore",
                        "fix-preserve": "bot-release/repair",
                        "fix-fresh": "bot-release/repair",
                    }[name]
                    accepted = await self.agent.post(
                        endpoint,
                        user,
                        {"fresh": name == "fix-fresh"} if name.startswith("fix-") else None,
                    )
                else:
                    accepted = await self.agent.post(
                        "system-updates/reboot?job_id="
                        + quote(action.get("job_id") or "", safe=""),
                        user,
                    )
                self.recovery.accepted(recovery_kind, accepted)
                panel = self.recovery.panel(
                    recovery_kind, action.get("action"), {**accepted, "phase": "queued"}
                )
                await interaction.edit_original_response(embeds=panel.embeds, view=None)
                self.spawn(self.recovery.resume(recovery_kind))
                return
            if kind == "host_update":
                accepted = await self.agent.post("system-updates/apply", user)
                self.spawn(self.host_progress(interaction, accepted))
                return
            if kind == "service":
                await self.agent.action(action["id"], action["action"], user)
            elif kind == "minecraft":
                await self.minecraft.action(action["id"], action["action"], user)
            elif kind == "apps":
                result = await self.with_loading(
                    interaction,
                    "updates",
                    self.agent.post("updates/" + quote(action["id"], safe=""), user, timeout=780),
                    Panel(
                        [
                            self.ui.embed(
                                "Updating Runtipi apps",
                                "Waiting for Runtipi to finish the backup, update and app verification.",
                            )
                        ]
                    ),
                )
                e = self.ui.embed(
                    "Application update result",
                    tip="Runtipi updates verified by Docker and app probes",
                )
                rows = result.get("results", [result])
                for row in rows[:20]:
                    latency = (row.get("verification") or {}).get("latency_ms")
                    field(
                        e,
                        clean(row.get("label") or row.get("id") or "App"),
                        clean(row.get("status") or "Result")
                        + (f" · {latency} ms" if latency is not None else "")
                        + ("\n" + safe_error(row["detail"]) if row.get("detail") else ""),
                    )
                await interaction.edit_original_response(
                    embeds=[e], view=PanelView(self, navigation("updates"))
                )
                return
            else:
                raise ValueError("Unsupported confirmed action")
            e = self.ui.embed(
                "Request accepted",
                "The panel accepted **"
                + clean(action["action"])
                + "**. Refresh the service to check its resulting state.",
                kind="ok",
            )
            await interaction.edit_original_response(
                embeds=[e],
                view=PanelView(
                    self, navigation("minecraft" if kind == "minecraft" else "services")
                ),
            )
        except (ValueError, OSError, discord.HTTPException) as exc:
            if recovery_kind and accepted:
                # Preserve the durable handoff if Discord editing fails during restart.
                self.spawn(self.recovery.resume(recovery_kind))
                return
            if recovery_kind:
                self.recovery.clear(recovery_kind)
            await self.fail(interaction, exc)

    async def host_progress(self, interaction, accepted):
        deadline = time.monotonic() + 780
        try:
            while time.monotonic() < deadline:
                status = await self.agent.get("system-updates", True)
                if status.get("job_id") == accepted.get("job_id") and status.get("phase") in {
                    "complete",
                    "ready_for_reboot",
                    "failed",
                }:
                    snapshot = await self.agent.get(
                        "updates", False, self.settings.read()["releaseChannel"]
                    )
                    panel = self.ui.updates(snapshot, status, True)
                    await interaction.edit_original_response(
                        embeds=panel.embeds, view=PanelView(self, panel.controls)
                    )
                    return
                await interaction.edit_original_response(
                    embeds=[
                        self.ui.embed(
                            "Host updates",
                            "◓ **"
                            + clean(status.get("phase", "queued"))
                            + "**\n"
                            + safe_error(status.get("detail") or "Waiting for the host bridge."),
                        )
                    ],
                    view=None,
                )
                await asyncio.sleep(4)
            raise ValueError(
                "The host update is still running. Open /updates for its current state."
            )
        except (ValueError, discord.HTTPException) as exc:
            await self.fail(interaction, exc)

    async def submit(self, interaction, key, value, text):
        try:
            self.require(interaction, superuser=key == "identity")
            await interaction.response.defer(ephemeral=True, thinking=True)
            if key == "identity":
                self.settings.identity(value, text.strip())
                await self.show(interaction, "settings/access")
            else:
                await self.minecraft.command(value, text)
                await interaction.edit_original_response(
                    embeds=[
                        self.ui.embed(
                            "Command sent",
                            "The Minecraft panel accepted the console command.",
                            kind="ok",
                        )
                    ],
                    view=PanelView(self, navigation("minecraft")),
                )
        except (ValueError, OSError, discord.HTTPException) as exc:
            await self.fail(interaction, exc)
