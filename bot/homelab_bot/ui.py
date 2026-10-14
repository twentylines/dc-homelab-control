from __future__ import annotations

import math
import re
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import UTC, datetime

import discord

from .api import safe_error

COLORS = {"normal": 0x5865F2, "ok": 0x3BA55D, "warn": 0xFAA61A, "bad": 0xED4245}
GLYPHS = ("◓", "◑", "◒", "◐")
PAGES = {
    "panel": "Home",
    "status": "Status",
    "services": "Services",
    "minecraft": "Minecraft",
    "storage": "Storage",
    "media": "Media",
    "tasks": "Tasks",
    "network": "Network",
    "updates": "Updates",
    "settings": "Settings",
    "controls": "Controls",
    "health": "Health",
    "report": "Report",
    "audit": "Audit",
    "help": "Help",
    "ping": "Ping",
}
TIPS = {
    "panel": "Choose a section to inspect your homelab",
    "status": "Live host and container status",
    "services": "Select a container for details and controls",
    "minecraft": "Select a server for resources and controls",
    "storage": "Capacity and drive health",
    "media": "Detected media services and activity",
    "tasks": "Container CPU can exceed 100% across multiple cores",
    "network": "Endpoint checks include protocol and measured latency",
    "updates": "Review release notes before installing an update",
    "controls": "Enabled controls apply only to configured administrators",
    "settings": "Changes persist across container restarts",
    "rollback": "Only the owner-approved golden version is recommended",
}


def clean(value, limit=160):
    text = str(value if value is not None else "Unknown")
    return re.sub(r"[\r\n`*_~|]", " ", text).replace("@", "＠").strip()[:limit]


def finite(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def size(value):
    value = finite(value)
    if value is None or value < 0:
        return "Size unavailable"
    units = ("B", "KiB", "MiB", "GiB", "TiB", "PiB")
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024


def pct(value):
    n = finite(value)
    return f"{n:.1f}%" if n is not None else "Not reported"


def bar(value):
    n = finite(value)
    if n is None:
        return "Usage not reported"
    n = max(0, min(100, n))
    filled = min(10, int(n / 10 + 0.5))
    return "▰" * filled + "▱" * (10 - filled) + f" {n:.0f}%"


def duration(value):
    seconds = max(0, int(finite(value) or 0))
    days, seconds = divmod(seconds, 86400)
    hours, seconds = divmod(seconds, 3600)
    minutes = seconds // 60
    return (
        " ".join(
            v
            for v in (
                f"{days}d" if days else "",
                f"{hours}h" if hours else "",
                f"{minutes}m" if minutes else "",
            )
            if v
        )
        or "<1m"
    )


def os_name(data):
    info = data.get("os") or data.get("operating_system") or data.get("host_os") or {}
    return clean(
        info.get("pretty_name") or info.get("name") or info.get("id") or "Host OS unavailable"
    )


def field(embed, name, value, inline=False):
    if value and len(embed.fields) < 25:
        budget = 5700 - len(embed) - len(name)
        if budget > 40:
            embed.add_field(
                name=clean(name, 256), value=str(value)[: min(1024, budget)], inline=inline
            )
    return embed


@dataclass
class Control:
    label: str
    key: str
    value: object = None
    style: discord.ButtonStyle = discord.ButtonStyle.secondary
    options: list[tuple[str, str, str]] = dataclass_field(default_factory=list)


@dataclass
class Panel:
    embeds: list[discord.Embed]
    controls: list[Control] = dataclass_field(default_factory=list)

    def fit(self):
        """Discord applies its 6000-character budget across all embeds together."""
        shortened = False
        while sum(len(e) for e in self.embeds) > 5900:
            last = self.embeds[-1]
            if last.fields:
                last.remove_field(len(last.fields) - 1)
            elif len(self.embeds) > 1:
                self.embeds.pop()
            else:
                last.description = (last.description or "")[:3000]
                break
            shortened = True
        if shortened:
            self.embeds[0].set_footer(text="Open the individual sections for additional details")
        return self


def navigation(page="panel", parent=None):
    if page not in PAGES and page != "rollback":
        page = "panel"
    result = [Control("Refresh", "page", page, discord.ButtonStyle.primary)]
    if parent and parent != "panel":
        result.append(Control("Back to " + PAGES.get(parent, parent), "page", parent))
    if page != "panel":
        result.append(Control("Back to home", "page", "panel"))
    if page == "panel":
        result.append(
            Control(
                "Open a section",
                "page",
                options=[
                    (label, key, "")
                    for key, label in PAGES.items()
                    if key not in {"panel", "controls", "health", "report", "audit", "help", "ping"}
                ],
            )
        )
    return result


def deep_navigation(parent, refresh_key, value=None):
    return [
        Control("Refresh", refresh_key, value, discord.ButtonStyle.primary),
        Control("Back to " + PAGES.get(parent, parent), "page", parent),
        Control("Back to home", "page", "panel"),
    ]


class Renderer:
    def __init__(self, cfg):
        self.cfg = cfg

    def embed(self, title, description="", *, kind="normal", tip="", host=None):
        if host is not None:
            title = (
                clean(self.cfg.get("SERVER_NAME") or host.get("hostname") or "Home server", 80)
                + " · "
                + title
            )
        embed = discord.Embed(
            title=title[:256],
            description=str(description)[:4000] or None,
            colour=COLORS[kind],
            timestamp=datetime.now(UTC),
        )
        embed.set_author(name=self.cfg.bot_name)
        if tip:
            embed.set_footer(text=tip[:240])
        return embed

    def loading(self, page, tick=0, previous=None):
        note = f"{GLYPHS[tick % 4]} Refreshing {PAGES.get(page, page).lower()}"
        if previous:
            embeds = [discord.Embed.from_dict(e.to_dict()) for e in previous.embeds]
            embeds[0].set_footer(text=note)
            return Panel(embeds, previous.controls)
        return Panel(
            [self.embed(PAGES.get(page, page), "Waiting for the requested snapshot.", tip=note)]
        )

    def error(self, error):
        secrets = [
            v
            for k, v in self.cfg.values.items()
            if any(word in k for word in ("TOKEN", "SECRET", "PASSWORD", "API_KEY", "WEBHOOK"))
        ]
        return Panel(
            [
                self.embed(
                    "Request needs attention",
                    safe_error(error, secrets),
                    kind="bad",
                    tip="Retry the request after checking the reported issue",
                )
            ],
            navigation("error"),
        )

    def assessment(self, data, services=(), media=(), summary=None):
        issues = []
        if (finite(data.get("temperature_c")) or 0) >= 85:
            issues.append("CPU temperature is high")
        memory = data.get("memory") or {}
        if memory.get("total") and memory.get("used", 0) / memory["total"] >= 0.9:
            issues.append("Memory is over 90% used")
        for disk in data.get("storage", []):
            if (finite(disk.get("percent")) or 0) >= 90:
                issues.append(clean(disk.get("label")) + " is nearly full")
        for drive in data.get("drives", []):
            if drive.get("warning") or drive.get("critical"):
                issues.append("Drive warning: " + clean(drive.get("model")))
        for service in services:
            if service.get("health") in {"unhealthy", "unreachable"}:
                issues.append("Check " + clean(service.get("label")))
        for provider in media:
            if not provider.get("online"):
                issues.append(clean(provider.get("label")) + " is unreachable")
        if summary and summary.get("assessed") and not summary.get("complete"):
            issues.append(
                "Media stack incomplete: " + ", ".join(map(clean, summary.get("missing", [])))
            )
        containers = data.get("containers") or {}
        for name in containers.get("unhealthy", []):
            text = "Unhealthy container: " + clean(name)
            if text not in issues:
                issues.append(text)
        return issues

    def host_fields(self, embed, data, compact=False):
        mem = data.get("memory") or {}
        mem_pct = 100 * mem.get("used", 0) / mem["total"] if mem.get("total") else None
        system = f"**CPU** {bar(data.get('cpu_percent'))}\n**Memory** {bar(mem_pct)}\n{size(mem.get('used'))} / {size(mem.get('total'))}"
        temp = finite(data.get("temperature_c"))
        if temp is not None:
            system += f"\n**Temperature** {temp:.0f}°C"
        field(embed, "System", system, True)
        containers = data.get("containers") or {}
        field(
            embed,
            "Runtime",
            f"**Uptime** {duration(data.get('uptime_seconds'))}\n**Containers** {containers.get('running', '?')}/{containers.get('total', '?')} running",
            True,
        )
        disks = [
            f"**{clean(d.get('label'))}**\n{bar(d.get('percent'))}\n{size(d.get('used'))} / {size(d.get('total'))}"
            for d in data.get("storage", [])
        ]
        field(embed, "Storage", "\n\n".join(disks), compact)
        if not compact:
            field(embed, "Host OS", os_name(data), True)
            info = data.get("container_os") or {}
            if info.get("id") and info.get("id") != "unknown":
                field(
                    embed,
                    "Control container",
                    clean(info.get("pretty_name") or info.get("name") or info.get("id")),
                    True,
                )
        return embed

    def overview(self, page, data, services=(), media=(), updates=None, summary=None):
        issues = self.assessment(data, services, media, summary)
        e = self.embed(
            "Health" if page == "health" else "Overview",
            "**Attention needed**\n" + "\n".join(issues[:5])
            if issues
            else "**All monitored systems healthy**",
            kind="warn" if issues else "ok",
            tip=TIPS.get(page, TIPS["status"]),
            host=data,
        )
        self.host_fields(e, data)
        if updates:
            field(e, "Software", self.software(updates, None))
        return Panel([e], navigation(page))

    def storage(self, data):
        e = self.embed("Storage", tip=TIPS["storage"], host=data)
        for disk in data.get("storage", []):
            field(
                e,
                clean(disk.get("label")),
                f"{bar(disk.get('percent'))}\n{size(disk.get('used'))} used · {size(disk.get('free'))} free",
            )
        field(
            e,
            "Drive health",
            "\n".join(
                f"**{clean(d.get('model'))}** · {clean(d.get('state'))}"
                + (f" · {d['temperature_c']}°C" if d.get("temperature_c") is not None else "")
                for d in data.get("drives", [])
            )
            or "Drive monitoring has not returned a sample.",
        )
        return Panel([e], navigation("storage"))

    def services(self, rows, page=0, policy=None, admin=False):
        controlling = policy is not None
        name = "controls" if controlling else "services"
        page = min(max(0, page), max(0, (len(rows) - 1) // 15))
        batch = rows[page * 15 : (page + 1) * 15]
        description = "No containers detected. Start a Docker service, then refresh."
        if rows:
            description = f"**{len(rows)} containers detected** · page {page + 1}/{max(1, (len(rows) + 14) // 15)}"
        e = self.embed(PAGES[name], description, tip=TIPS[name])
        if controlling:
            mode = policy.get("mode", "opt-out")
            field(
                e,
                "How controls work",
                "Administrators can start, stop and restart detected containers after confirmation. Guests can inspect them. Protected containers always stay read-only.\n"
                + (
                    "Opt-out: controls are enabled unless you disable them below."
                    if mode == "opt-out"
                    else "Opt-in: enable each container before it can be controlled."
                ),
            )
        for item in batch:
            state = (
                "Protected"
                if item.get("protected")
                else "Enabled"
                if item.get("manageable")
                else "Read-only"
            )
            value = (
                state
                if controlling
                else f"{clean(item.get('state'))} · {clean(item.get('health'))}"
            )
            field(e, clean(item.get("label") or item.get("key")), value, True)
        controls = navigation(name)
        if batch:
            controls.append(
                Control(
                    "Choose a container",
                    "control_detail" if controlling else "service_detail",
                    options=[
                        (
                            clean(s.get("label") or s.get("key"), 100),
                            str(s["key"]),
                            "Protected" if s.get("protected") else "",
                        )
                        for s in batch
                    ],
                )
            )
        if page:
            controls.append(
                Control(
                    "Previous page", "controls_page" if controlling else "services_page", page - 1
                )
            )
        if (page + 1) * 15 < len(rows):
            controls.append(
                Control("Next page", "controls_page" if controlling else "services_page", page + 1)
            )
        if controlling and admin:
            controls.append(
                Control(
                    "Default control policy",
                    "control_mode",
                    options=[
                        ("Opt-out", "opt-out", "New containers get controls unless disabled"),
                        ("Opt-in", "opt-in", "New containers stay read-only until enabled"),
                    ],
                )
            )
        return Panel([e], controls)

    def service_detail(self, item, admin, control=False):
        e = self.embed(
            clean(item.get("label") or item.get("key")),
            f"**{clean(item.get('state'))}** · {clean(item.get('health'))}",
            tip="Container controls require administrator confirmation",
        )
        field(e, "Container", clean(item.get("container"), 200))
        field(
            e,
            "Details",
            clean(
                item.get("health_detail") or item.get("status") or "No extra status returned", 900
            ),
        )
        controls = deep_navigation(
            "controls" if control else "services",
            "control_detail" if control else "service_detail",
            item["key"],
        )
        if control:
            field(
                e,
                "Control access",
                "Protected: controls cannot be enabled"
                if item.get("protected")
                else "Enabled"
                if item.get("manageable")
                else "Read-only",
            )
            if admin and not item.get("protected"):
                controls.append(
                    Control(
                        "Disable controls" if item.get("manageable") else "Enable controls",
                        "control_toggle",
                        (item["key"], not item.get("manageable")),
                    )
                )
        else:
            if admin:
                controls.append(Control("Recent logs", "logs", item["key"]))
            if admin and item.get("manageable") and not item.get("protected"):
                for action in ["restart", "stop"] if item.get("state") == "running" else ["start"]:
                    controls.append(
                        Control(
                            action.title(),
                            "service_action",
                            (item["key"], action),
                            discord.ButtonStyle.danger
                            if action == "stop"
                            else discord.ButtonStyle.secondary,
                        )
                    )
        return Panel([e], controls)

    def software(self, updates, host):
        lines = []
        bot = (updates or {}).get("bot") or {}
        if bot.get("configured"):
            channel = "Beta channel" if bot.get("channel") == "beta" else "Stable channel"
            if bot.get("available") is False:
                lines.append(f"**{channel}** · GitHub check unavailable")
            elif bot.get("update_available"):
                lines.append(
                    f"**{channel}** · {clean(bot.get('current'))} → **{clean(bot.get('latest'))}**"
                )
            else:
                lines.append(f"**{channel}** · {clean(bot.get('current'))}")
        if updates and updates.get("available"):
            lines.append(f"**Runtipi apps** · {len(updates.get('updates', []))} updates available")
        if host and host.get("available"):
            count = host.get("pending_count")
            lines.append(
                f"**{os_name(host)}** · {count if count is not None else 'Unknown'} pending"
            )
        return "\n".join(lines) or "Update sources have not returned a status."

    def updates(self, snapshot, host, admin):
        bot = snapshot.get("bot") or {}
        e = self.embed("Updates", self.software(snapshot, host), tip=TIPS["updates"])
        controls = navigation("updates")
        if bot.get("configured"):
            text = f"**Source download** {size(bot.get('asset_size'))}"
            if bot.get("available") is False:
                text += "\n" + safe_error(bot.get("detail", "GitHub release check failed"))
            if bot.get("update_available"):
                text += "\n" + (
                    "Archive verified"
                    if bot.get("asset_verified")
                    else "Waiting for a verified archive"
                )
            field(e, self.cfg.bot_name, text)
        else:
            field(
                e,
                "Bot releases",
                "Set HOMELAB_CONTROL_REPOSITORY to twentylines/dc-homelab-control.",
            )
        if host:
            text = "**Host OS** " + os_name(host)
            text += f"\n**Phase** {clean(host.get('phase', 'idle')).replace('_', ' ').title()}"
            if host.get("available"):
                text += f"\n**Security updates** {host.get('security_count') if host.get('security_count') is not None else 'Not reported'}"
            else:
                text += "\n" + safe_error(host.get("detail", "Host update check unavailable"))
            info = host.get("container_os") or {}
            if info.get("id") and info.get("id") != "unknown":
                text += "\n**Control container** " + clean(
                    info.get("pretty_name") or info.get("name") or info.get("id")
                )
            if host.get("reboot_required"):
                text += "\nA separately confirmed restart is required."
            if host.get("deferred_packages"):
                text += f"\n{len(host['deferred_packages'])} packages deferred by the host."
            field(e, "Host updates", text)
        apps = snapshot.get("updates") or []
        if snapshot.get("available"):
            field(
                e,
                "Runtipi",
                "\n".join(
                    f"**{clean(a.get('label'))}** · {clean(a.get('current'))} → {clean(a.get('latest'))}"
                    for a in apps[:12]
                )
                or "All eligible apps are current.",
            )
        if admin:
            if (
                bot.get("update_available")
                and bot.get("asset_verified")
                and bot.get("update_supported")
            ):
                controls.append(
                    Control(
                        "Update bot · " + clean(bot.get("latest"), 35),
                        "bot_update",
                        style=discord.ButtonStyle.success,
                    )
                )
            if bot.get("update_supported") and (
                bot.get("rollback_available") or bot.get("rollback_options")
            ):
                controls.append(Control("Rollback options", "rollback"))
            if (
                host
                and host.get("maintenance_available")
                and host.get("update_supported") is not False
            ):
                if host.get("phase") == "ready_for_reboot" and host.get("reboot_required"):
                    controls.append(
                        Control("Restart host", "host_reboot", style=discord.ButtonStyle.danger)
                    )
                elif (host.get("pending_count") or 0) > 0 and host.get("phase") not in {
                    "checking",
                    "applying",
                    "rebooting",
                    "ready_for_reboot",
                }:
                    controls.append(Control("Update host", "host_update"))
            if apps:
                controls.append(Control("Update all eligible apps", "apps_update"))
                controls.append(
                    Control(
                        "Update one app",
                        "app_update",
                        options=[
                            (clean(a.get("label"), 100), str(a["id"]), clean(a.get("latest"), 100))
                            for a in apps[:25]
                        ],
                    )
                )
        return Panel([e], controls)

    def rollback(self, release):
        options = release.get("rollback_options") or release.get("github_rollback_options") or []
        quick = [
            o
            for o in release.get("rollback_quick_options", options)
            if (o.get("quick_role") or o.get("approval")) in {"golden", "last_major"}
        ]
        e = self.embed(
            "Rollback options",
            f"Current version **{clean(release.get('current'))}**\n\nOnly the owner-approved golden version is recommended. Every other version is not recommended and may be broken or obsolete. Much older versions may be incompatible with your current configuration and data.",
            kind="warn",
            tip=TIPS["rollback"],
        )
        controls = deep_navigation("updates", "rollback")
        seen = set()
        for item in quick:
            version = str(item.get("version", ""))
            if version in seen or len(seen) >= 2:
                continue
            seen.add(version)
            role = (
                "Owner-approved golden version"
                if (item.get("quick_role") or item.get("approval")) == "golden"
                else "Last major release · not recommended"
            )
            field(e, "v" + clean(version), role + "\n" + size(item.get("asset_size")))
            controls.append(
                Control("Rollback to v" + clean(version, 45), "rollback_version", version)
            )
        if release.get("rollback_available") and release.get("rollback_source") == "local":
            version = clean(release.get("rollback_version") or "unlabelled version")
            field(e, "Retained legacy images", version + " · stored locally · not recommended")
            controls.append(Control("Rollback to retained legacy versions", "rollback_retained"))
        if options:
            controls.append(
                Control(
                    "Choose a legacy version · not recommended",
                    "rollback_version",
                    options=[
                        (
                            "v" + clean(o.get("version"), 60),
                            str(o["version"]),
                            size(o.get("asset_size")),
                        )
                        for o in options[:25]
                    ],
                )
            )
        elif release.get("github_rollback_detail"):
            field(e, "GitHub history", safe_error(release["github_rollback_detail"]))
        return Panel([e], controls)

    def tasks(self, snapshot, page=0, live=False):
        if not snapshot.get("available"):
            return self.error(snapshot.get("detail", "Docker resource sample unavailable"))
        rows = snapshot.get("containers") or []
        page = min(max(0, page), max(0, (len(rows) - 1) // 12))
        batch = rows[page * 12 : (page + 1) * 12]
        docker, host = snapshot.get("docker") or {}, snapshot.get("host_memory") or {}
        e = self.embed(
            "Task manager",
            f"**{docker.get('sampled', len(rows))}/{docker.get('running', len(rows))} containers sampled**"
            + (" · live for 1 minute" if live else ""),
            tip=TIPS["tasks"],
        )
        field(
            e,
            "Overall",
            f"**Host memory** {size(host.get('used'))} / {size(host.get('total'))}\n**Docker working set** {size(docker.get('memory_used'))}\n**Docker CPU sum** {pct(docker.get('cpu_percent'))}",
        )
        groups = {}
        for row in rows:
            if re.search(
                r"jellyfin|plex|emby|sonarr|radarr|seerr|prowlarr|qbit",
                str(row.get("label", "")) + str(row.get("name", "")),
                re.I,
            ):
                groups.setdefault("Media", []).append(row)
            elif re.search(
                r"minecraft|crafty|forge|fabric|paper|purpur",
                str(row.get("label", "")) + str(row.get("name", "")),
                re.I,
            ):
                groups.setdefault("Minecraft", []).append(row)
        for key, group in groups.items():
            field(
                e,
                key + " total",
                f"{pct(sum(finite(r.get('cpu_percent')) or 0 for r in group))} CPU · {size(sum(finite(r.get('memory_used')) or 0 for r in group))} RAM",
                True,
            )
        for row in batch:
            field(
                e,
                clean(row.get("label") or row.get("name")),
                f"**CPU** {pct(row.get('cpu_percent'))} · **RAM** {size(row.get('memory_used'))}",
                True,
            )
        if snapshot.get("failed"):
            field(
                e, "Sampling attention", f"{len(snapshot['failed'])} container samples unavailable"
            )
        controls = navigation("tasks")
        controls.append(
            Control(
                "Stop live" if live else "Live · 1 minute", "tasks_stop" if live else "tasks_live"
            )
        )
        if batch:
            controls.append(
                Control(
                    "Inspect a container",
                    "task_detail",
                    options=[
                        (clean(r.get("label") or r.get("name"), 100), str(r["id"]), "")
                        for r in batch
                    ],
                )
            )
        if page:
            controls.append(Control("Previous page", "tasks_page", page - 1))
        if (page + 1) * 12 < len(rows):
            controls.append(Control("Next page", "tasks_page", page + 1))
        return Panel([e], controls)

    def task_detail(self, task):
        e = self.embed(
            clean(task.get("label") or task.get("name")), tip="Resource counters are read-only"
        )
        field(e, "CPU", pct(task.get("cpu_percent")), True)
        field(
            e, "Memory", f"{size(task.get('memory_used'))} / {size(task.get('memory_limit'))}", True
        )
        field(e, "Processes", str(task.get("pids", "Not reported")), True)
        field(
            e,
            "Network since start",
            f"↓ {size(task.get('network_rx'))} · ↑ {size(task.get('network_tx'))}",
        )
        return Panel([e], deep_navigation("tasks", "task_detail", task["id"]))

    def minecraft(self, servers, selected=None, admin=False, page=0):
        e = self.embed(
            clean(selected.get("name")) if selected else "Minecraft", tip=TIPS["minecraft"]
        )
        rows = [selected] if selected else servers[page * 12 : (page + 1) * 12]
        if not rows:
            e.description = "No Minecraft servers detected. Configure your panel or start a Minecraft container, then refresh."
        for row in rows:
            r = row.get("resources") or {}
            state = (
                "Status unknown"
                if row.get("state") == "unknown"
                else "Online"
                if row.get("running")
                else "Offline"
            )
            value = f"**{state}** · {clean(row.get('panel'))}\n**CPU** {pct(r.get('cpu_percent'))} · **RAM** {size(r.get('memory_used'))}"
            if r.get("memory_limit"):
                value += " / " + size(r["memory_limit"])
            if row.get("resource_error"):
                value += "\n" + safe_error(row["resource_error"])
            field(e, clean(row.get("name")), value)
            if selected:
                field(
                    e,
                    "Resources",
                    f"**Processes** {r.get('pids', 'Not reported')}\n**Disk** {size(r.get('disk_used'))}\n**Network** ↓ {size(r.get('network_rx'))} · ↑ {size(r.get('network_tx'))}",
                )
        controls = (
            deep_navigation("minecraft", "mc_detail", selected["id"])
            if selected
            else navigation("minecraft")
        )
        if not selected and rows:
            controls.append(
                Control(
                    "Inspect a server",
                    "mc_detail",
                    options=[(clean(r.get("name"), 100), str(r["id"]), "") for r in rows],
                )
            )
            if page:
                controls.append(Control("Previous page", "mc_page", page - 1))
            if (page + 1) * 12 < len(servers):
                controls.append(Control("Next page", "mc_page", page + 1))
        if selected and admin and selected.get("manageable") and not selected.get("protected"):
            for action in (
                ["restart", "stop", "backup"] if selected.get("running") else ["start", "backup"]
            ):
                controls.append(
                    Control(
                        action.title(),
                        "mc_action",
                        (selected["id"], action),
                        discord.ButtonStyle.danger
                        if action == "stop"
                        else discord.ButtonStyle.secondary,
                    )
                )
            controls.append(Control("Console", "mc_console", selected["id"]))
        return Panel([e], controls)

    def media(self, rows, jelly, plex, host, usage, summary):
        e = self.embed(
            "Media",
            f"**{sum(bool(r.get('online')) for r in rows)}/{len(rows)} providers online**"
            if rows
            else "No media services detected.",
            tip=TIPS["media"],
            host=host or {},
        )
        if summary and summary.get("assessed"):
            field(
                e,
                "Stack",
                "Complete"
                if summary.get("complete")
                else "**Incomplete**\nMissing: "
                + ", ".join(map(clean, summary.get("missing", []))),
            )
        if usage and usage.get("available"):
            field(
                e,
                "Overall resources",
                f"**CPU** {pct(usage.get('cpu_percent'))} · **RAM** {size(usage.get('memory_used'))}",
            )
        if rows:
            field(e, "Services", "\n".join(self.provider(r) for r in rows))
        for name, playback in (("Jellyfin", jelly), ("Plex", plex)):
            if not playback or not playback.get("enabled"):
                continue
            sessions = playback.get("sessions") or []
            field(
                e,
                name + " playback",
                "\n\n".join(
                    f"**{clean(s.get('title'))}**\n{clean(s.get('user'))} · {clean(s.get('device'))} · {clean(s.get('play_method') or s.get('state'))}"
                    for s in sessions
                )
                or "No active playback sessions.",
            )
            added, seen = [], set()
            for item in playback.get("recently_added") or []:
                title = clean(item.get("title"))
                if item.get("season") is not None:
                    title += f" · S{int(item['season']):02d}"
                elif item.get("type") == "Movie" and item.get("year"):
                    title += " · " + str(item["year"])
                if title not in seen:
                    added.append(title)
                    seen.add(title)
            field(e, name + " recently added", "\n".join(added[:8]))
            library = playback.get("library") or {}
            field(e, name + " library", " · ".join(f"{clean(k)} {v}" for k, v in library.items()))
            if playback.get("detail"):
                field(e, name + " details", safe_error(playback["detail"]))
            if playback.get("alerts"):
                field(
                    e,
                    name + " alerts",
                    "\n".join(clean(a.get("name")) for a in playback["alerts"][:4]),
                )
        for disk in (host or {}).get("storage", []):
            if re.search(r"media|jellyfin|plex", disk.get("label", ""), re.I):
                field(
                    e,
                    clean(disk.get("label")),
                    f"{bar(disk.get('percent'))}\n{size(disk.get('used'))} used · {size(disk.get('free'))} free",
                )
        return Panel([e], navigation("media"))

    def provider(self, row):
        state = "Online" if row.get("online") else "Unreachable"
        process_only = row.get("health_source") in {"docker", "process"} and not row.get(
            "probe_type"
        )
        if process_only or row.get("probe_type") in {"process", "container"}:
            state = "Container running"
        latency = finite(row.get("latency_ms")) if not process_only else None
        timing = (
            f" · {clean(row.get('probe_type') or 'probe')} {latency:.0f} ms"
            if latency is not None
            else ""
        )
        return f"**{clean(row.get('label') or row.get('id'))}** · {state}{timing}"

    def network(self, providers, summary, host, connectivity):
        e = self.embed(
            "Network",
            f"**{sum(bool(p.get('online')) for p in providers)}/{len(providers)} providers online**"
            if providers
            else "No network providers detected.",
            tip=TIPS["network"],
            host=host,
        )
        for provider in providers:
            field(e, clean(provider.get("label")), self.provider(provider))
        if summary and summary.get("assessed") and not summary.get("complete"):
            field(e, "Incomplete", "Missing: " + ", ".join(map(clean, summary.get("missing", []))))
        for name in ("gateway", "dns"):
            probe = (connectivity or {}).get(name) or {}
            if not probe:
                continue
            status = (
                "Not configured"
                if probe.get("configured") is False
                else "Reachable"
                if probe.get("reachable")
                else "Unreachable"
            )
            value = status
            if probe.get("configured") is not False and probe.get("latency_ms") is not None:
                value += f" · {probe['latency_ms']} ms"
            field(e, "Internal gateway" if name == "gateway" else "DNS", value, True)
        return Panel([e], navigation("network"))

    def weekly(self, data, services, media, host, updates, summary):
        issues = self.assessment(data, services, media, summary)
        name = clean(self.cfg.get("SERVER_NAME") or data.get("hostname") or "Home server", 80)
        e = self.embed(
            name + " Weekly Health",
            "**Attention needed**\n" + "\n".join(issues[:3])
            if issues
            else "All monitored systems healthy",
            kind="warn" if issues else "ok",
            tip="Weekly health summary · Sundays at 20:00 " + self.cfg.get("TIME_ZONE", "UTC"),
        )
        self.host_fields(e, data, True)
        field(
            e,
            "Drive health",
            "\n".join(
                f"**{clean(d.get('model'))}** · {clean(d.get('state'))}"
                + (f" · {d['temperature_c']}°C" if d.get("temperature_c") is not None else "")
                for d in data.get("drives", [])
            ),
        )
        field(e, "Updates", self.software(updates, host))
        return e
