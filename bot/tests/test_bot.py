from __future__ import annotations

import asyncio
import copy
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import aiohttp
import discord
from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from homelab_bot import __version__
from homelab_bot.api import Agent, safe_error
from homelab_bot.config import Config, load_env
from homelab_bot.controller import Controller
from homelab_bot.main import DESCRIPTIONS, HomelabBot
from homelab_bot.minecraft import Minecraft, crafty_tls
from homelab_bot.scheduler import allowed_release, version_key
from homelab_bot.state import Settings, write_json
from homelab_bot.ui import Panel, Renderer, bar, size
from homelab_bot.views import Confirmation, PanelView
from homelab_bot.wake import normalise_mac

OWNER, ADMIN, GUEST, OTHER = (str(123456789012345670 + n) for n in range(4))
ROOT = Path(__file__).resolve().parents[2]


def config(directory, **extra):
    return Config.load(
        {
            "HOMELAB_CONTROL_CONFIG_FILE": str(directory / "absent.env"),
            "BOT_DATA_DIR": str(directory),
            "CONTROL_TOKEN": "test-control-" + "0" * 32,
            "DISCORD_TOKEN": "test-discord-token",
            "DISCORD_CLIENT_ID": OWNER,
            "DISCORD_GUILD_ID": OWNER,
            "DISCORD_OWNER_ID": OWNER,
            "DISCORD_ADMIN_USER_IDS": ADMIN,
            "DISCORD_GUEST_USER_IDS": GUEST,
            "TIME_ZONE": "UTC",
            **extra,
        }
    )


def interaction(user=OWNER, component=True):
    response = SimpleNamespace(
        is_done=lambda: False,
        send_message=AsyncMock(),
        edit_message=AsyncMock(),
        send_modal=AsyncMock(),
    )

    async def defer(**kwargs):
        response.is_done = lambda: True

    response.defer = AsyncMock(side_effect=defer)
    obj = SimpleNamespace(
        id=9001,
        application_id=int(OWNER),
        token="a" * 80,
        guild_id=int(OWNER),
        user=SimpleNamespace(id=int(user), name="Test user", roles=[]),
        type=discord.InteractionType.component
        if component
        else discord.InteractionType.application_command,
        message=SimpleNamespace(id=777, embeds=[]),
        response=response,
        client=SimpleNamespace(latency=0.014),
        data={},
    )
    obj.edit_original_response = AsyncMock(return_value=SimpleNamespace(id=777))
    return obj


SERVICE = {
    "key": "test-service",
    "label": "Test service",
    "container": "test-service-1",
    "state": "running",
    "health": "healthy",
    "manageable": True,
    "protected": False,
}
TASK = {
    "id": "task-one",
    "label": "Jellyfin test",
    "name": "jellyfin",
    "cpu_percent": 2.1,
    "memory_used": 1024**3,
    "memory_limit": 2 * 1024**3,
    "pids": 40,
    "network_rx": 2000,
    "network_tx": 4000,
}
HOST = {
    "hostname": "Test host",
    "cpu_percent": 12,
    "memory": {"used": 2 * 1024**3, "total": 8 * 1024**3},
    "containers": {"total": 1, "running": 1, "unhealthy": []},
    "storage": [{"label": "Media", "total": 10000, "used": 3000, "free": 7000, "percent": 30}],
    "drives": [{"model": "Test drive", "state": "Healthy", "temperature_c": 35}],
    "uptime_seconds": 90000,
    "os": {"id": "ubuntu", "pretty_name": "Ubuntu 24.04 LTS"},
    "container_os": {"id": "alpine", "pretty_name": "Alpine Linux"},
}
RELEASE = {
    "configured": True,
    "available": True,
    "current": "0.4.1",
    "latest": "0.5.0",
    "channel": "stable",
    "update_available": True,
    "asset_verified": True,
    "asset_size": 102400,
    "update_supported": True,
    "release_notes": "Refactored Discord interface.\nPython runtime and restart handoff.",
    "rollback_available": True,
    "rollback_source": "local",
    "rollback_version": "0.4.0d",
    "rollback_options": [
        {"version": "0.4.0d", "asset_size": 1000},
        {"version": "0.3.22c", "asset_size": 900, "approval": "golden"},
    ],
    "rollback_quick_options": [
        {"version": "0.3.22c", "quick_role": "golden", "asset_size": 900},
        {"version": "0.4.0", "quick_role": "last_major", "asset_size": 800},
    ],
}
SERVER = {
    "id": "server-one",
    "name": "Test Minecraft",
    "backend": "crafty",
    "panel": "Crafty",
    "running": True,
    "manageable": True,
    "resources": {"cpu_percent": 5, "memory_used": 100000, "pids": 20},
}


class FakeAgent:
    def __init__(self):
        self.values = {
            "status": HOST,
            "services": [SERVICE],
            "control-policy": {"mode": "opt-out", "services": [SERVICE]},
            "tasks": {
                "available": True,
                "containers": [TASK],
                "docker": {"running": 1, "sampled": 1, "memory_used": 100000, "cpu_percent": 2},
                "host_memory": HOST["memory"],
            },
            "media": [{"id": "jellyfin", "label": "Jellyfin", "online": True, "latency_ms": 5}],
            "jellyfin": {
                "enabled": True,
                "sessions": [],
                "recently_added": [
                    {"title": "Test show", "season": 2},
                    {"title": "Test show", "season": 2},
                ],
                "library": {"Movies": 2},
            },
            "plex": {"enabled": False},
            "media-resources": {"available": True, "memory_used": 1000000, "cpu_percent": 12},
            "media-summary": {"assessed": True, "complete": False, "missing": ["radarr"]},
            "network": [
                {
                    "id": "adguard",
                    "label": "AdGuard",
                    "online": True,
                    "probe_type": "TCP connect",
                    "latency_ms": 5,
                }
            ],
            "network-summary": {"assessed": False},
            "network-connectivity": {
                "gateway": {"reachable": True, "latency_ms": 1},
                "dns": {"configured": False},
            },
            "ping": {"gateway": {"latency_ms": 1}},
            "updates": {
                "available": True,
                "bot": RELEASE,
                "updates": [{"id": "test-app", "label": "Test app", "current": "1", "latest": "2"}],
            },
            "system-updates": {
                "available": True,
                "maintenance_available": True,
                "update_supported": True,
                "pending_count": 3,
                "phase": "idle",
                "job_id": "job-one",
                **{k: HOST[k] for k in ("os", "container_os")},
            },
            "audit": [],
            "minecraft": {"servers": [SERVER]},
        }
        self.post = AsyncMock(return_value={"job_id": "job-one", "version": "0.5.0"})
        self.values = copy.deepcopy(self.values)
        self.action = AsyncMock(return_value={"ok": True})
        self.logs = AsyncMock(return_value=["No test errors"])
        self.calls = []

    async def get(self, name, *args):
        self.calls.append(name)
        return copy.deepcopy(self.values[name])


class FixtureCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.cfg = config(self.directory)
        self.settings = Settings(self.cfg)
        self.agent = FakeAgent()
        self.mc = SimpleNamespace(
            servers=AsyncMock(return_value=[SERVER]), action=AsyncMock(), command=AsyncMock()
        )
        self.controller = Controller(
            self.cfg, self.settings, self.agent, self.mc, Renderer(self.cfg), SimpleNamespace()
        )

    async def asyncTearDown(self):
        await self.controller.close()
        self.tmp.cleanup()

    def assert_panel(self, panel):
        self.assertLessEqual(sum(len(e) for e in panel.embeds), 6000)
        for embed in panel.embeds:
            self.assertLessEqual(len(embed.title or ""), 256)
            self.assertLessEqual(len(embed.description or ""), 4096)
            self.assertLessEqual(len(embed.fields), 25)
            for f in embed.fields:
                self.assertLessEqual(len(f.value), 1024)
        view = PanelView(self.controller, panel.controls)
        wire = view.to_components()
        self.assertLessEqual(len(wire), 5)
        identities = [item.custom_id for item in view.children]
        self.assertEqual(len(identities), len(set(identities)))
        self.assertTrue(all(len(i) <= 100 for i in identities))
        return view


class BotTests(FixtureCase):
    async def test_home_uses_direct_buttons_and_each_opens_its_panel(self):
        panel = await self.controller.payload("panel", interaction())
        view = self.assert_panel(panel)
        self.assertEqual(
            [control.value for control in panel.controls],
            [
                "panel",
                "status",
                "services",
                "minecraft",
                "storage",
                "media",
                "tasks",
                "network",
                "updates",
                "settings",
            ],
        )
        self.assertTrue(all(isinstance(item, discord.ui.Button) for item in view.children))
        self.assertEqual([len(row["components"]) for row in view.to_components()], [5, 5])
        for item, definition in zip(view.children, panel.controls):
            with self.subTest(section=definition.value):
                request = interaction()
                await item.callback(request)
                response = request.edit_original_response.call_args.kwargs
                self.assertNotIn("Request needs attention", response["embeds"][0].title)
                self.assertNotEqual(response["embeds"][0].title, "Request failed")
        self.agent.post.assert_not_awaited()
        self.agent.action.assert_not_awaited()
        self.mc.action.assert_not_awaited()

    async def test_home_hides_unavailable_sections_and_guest_settings(self):
        self.agent.values["media"] = []
        self.cfg.values["MINECRAFT_BACKEND"] = "none"
        for user in (OWNER, GUEST):
            with self.subTest(user=user):
                panel = await self.controller.payload("panel", interaction(user))
                self.assert_panel(panel)
                sections = {control.value for control in panel.controls}
                self.assertNotIn("media", sections)
                self.assertNotIn("minecraft", sections)
                self.assertEqual("settings" in sections, user == OWNER)
                self.assertIn("updates", sections)
                self.assertIn("services", sections)

    async def test_all_reader_commands_and_settings_payloads(self):
        bot = HomelabBot(self.cfg)
        self.assertEqual(
            set(c.name for c in bot.tree.get_commands()), set(DESCRIPTIONS) | {"settings", "wake"}
        )
        for page in [
            *DESCRIPTIONS,
            "settings",
            "settings/access",
            "settings/updates",
            "settings/recovery",
        ]:
            with self.subTest(page=page):
                self.assert_panel(await self.controller.payload(page, interaction()))
        await bot.close()

    async def test_large_lists_paginate_without_discord_limits(self):
        for count in (0, 1, 15, 25, 38, 100):
            rows = [
                {**SERVICE, "key": f"key-{n}", "label": "Container " + str(n)} for n in range(count)
            ]
            for page in range(max(1, (count + 14) // 15)):
                panel = self.controller.ui.services(rows, page, {"mode": "opt-out"}, True)
                self.assert_panel(panel)
            tasks = [{**TASK, "id": str(n), "label": "Task " + str(n)} for n in range(count)]
            self.assert_panel(self.controller.ui.tasks({"available": True, "containers": tasks}))

    async def test_guest_readonly_and_role_rechecks(self):
        self.assertEqual(self.settings.access(interaction(GUEST)), "guest")
        self.assertEqual(self.settings.access(interaction(OTHER)), "none")
        for page in DESCRIPTIONS:
            self.assert_panel(await self.controller.payload(page, interaction(GUEST)))
        with self.assertRaises(ValueError):
            await self.controller.payload("settings", interaction(GUEST))
        for key, value in (
            ("bot_update", None),
            ("maintenance", "restart"),
            ("control_toggle", (SERVICE["key"], False)),
            ("auto_mode", "daily"),
            ("service_action", (SERVICE["key"], "stop")),
            ("mc_action", (SERVER["id"], "stop")),
            ("host_update", None),
            ("rollback_version", "0.4.0d"),
            ("identity_remove", "guestUserIds:" + GUEST),
        ):
            await self.controller.dispatch(interaction(GUEST), key, value)
        self.agent.post.assert_not_awaited()
        self.agent.action.assert_not_awaited()
        self.mc.action.assert_not_awaited()

    async def test_settings_migrate_deny_lists_and_owner_protection(self):
        write_json(
            self.settings.path,
            {
                "adminUserIds": [],
                "disabledAdminUserIds": [ADMIN],
                "disabledSuperuserIds": [OWNER],
                "postUpdateNotice": {"version": "0.5.0"},
            },
        )
        self.assertEqual(self.settings.access(interaction(ADMIN)), "none")
        self.assertEqual(self.settings.access(interaction(OWNER)), "superuser")
        self.settings.identity("adminUserIds", ADMIN)
        self.assertEqual(self.settings.access(interaction(ADMIN)), "admin")
        self.settings.identity("adminUserIds", ADMIN, True)
        self.assertEqual(self.settings.access(interaction(ADMIN)), "none")
        with self.assertRaises(ValueError):
            self.settings.identity("superuserIds", OWNER, True)
        self.assertEqual(os.stat(self.settings.path).st_mode & 0o777, 0o600)
        self.assertIsNotNone(self.settings.consume_notice())
        self.assertIsNone(self.settings.consume_notice())

    async def test_corrupt_settings_fail_closed_for_non_owner(self):
        self.settings.path.write_text("{")
        with self.assertRaises(ValueError):
            self.settings.access(interaction(ADMIN))
        self.assertEqual(self.settings.access(interaction(OWNER)), "superuser")

    async def test_navigation_and_readonly_callbacks(self):
        for key, value in (
            ("page", "panel"),
            ("page", "help"),
            ("tasks_page", 0),
            ("controls_page", 0),
            ("services_page", 0),
            ("mc_page", 0),
            ("service_detail", SERVICE["key"]),
            ("control_detail", SERVICE["key"]),
            ("task_detail", TASK["id"]),
            ("mc_detail", SERVER["id"]),
            ("rollback", None),
            ("logs", SERVICE["key"]),
        ):
            with self.subTest(key=key):
                item = interaction()
                await self.controller.dispatch(item, key, value)
                self.assertTrue(item.edit_original_response.called)
                payload = item.edit_original_response.call_args.kwargs
                self.assertNotIn("Request needs attention", payload["embeds"][0].title)
                if payload.get("view"):
                    self.assertLessEqual(len(payload["view"].to_components()), 5)

    async def test_buttons_dispatch_their_real_key_and_value(self):
        panel = await self.controller.payload("services", interaction())
        view = self.assert_panel(panel)
        self.controller.dispatch = AsyncMock()
        for item, definition in zip(view.children, panel.controls):
            if isinstance(item, discord.ui.Select):
                item._values = [definition.options[0][1]]
            await item.callback(interaction())
            self.controller.dispatch.assert_awaited_with(
                unittest.mock.ANY,
                definition.key,
                definition.options[0][1] if definition.options else definition.value,
            )

    async def test_confirmation_owner_expiry_replay_and_revoked_admin(self):
        view = Confirmation(
            self.controller,
            int(OWNER),
            {"type": "service", "id": SERVICE["key"], "action": "stop"},
            Panel([]),
        )
        self.assertFalse(await view.interaction_check(interaction(ADMIN)))
        view.expires = 0
        await view.children[0].callback(interaction())
        self.agent.action.assert_not_awaited()
        view = Confirmation(
            self.controller,
            int(ADMIN),
            {"type": "service", "id": SERVICE["key"], "action": "stop"},
            Panel([]),
        )
        self.settings.identity("adminUserIds", ADMIN, True)
        await view.children[0].callback(interaction(ADMIN))
        self.agent.action.assert_not_awaited()
        view = Confirmation(
            self.controller,
            int(OWNER),
            {"type": "service", "id": SERVICE["key"], "action": "stop"},
            Panel([]),
        )
        await view.children[0].callback(interaction())
        await view.children[0].callback(interaction())
        self.assertEqual(self.agent.action.await_count, 1)

    async def test_update_confirmation_includes_notes_and_size(self):
        item = interaction()
        await self.controller.dispatch(item, "bot_update")
        payload = item.edit_original_response.call_args.kwargs
        text = json.dumps([e.to_dict() for e in payload["embeds"]])
        self.assertIn("100.0 KiB", text)
        self.assertIn("Refactored Discord interface", text)
        self.agent.post.assert_not_awaited()

    async def test_release_changed_after_confirmation_is_not_installed(self):
        await self.controller.execute(
            interaction(), {"type": "release", "action": "update", "target": "0.4.2"}
        )
        self.agent.post.assert_not_awaited()

    async def test_rollback_quick_choices_and_download_sizes(self):
        panel = self.controller.ui.rollback(RELEASE)
        self.assert_panel(panel)
        buttons = [c for c in panel.controls if c.key == "rollback_version" and not c.options]
        self.assertEqual(len(buttons), 2)
        self.assertFalse(any("Golden" in c.label for c in panel.controls))
        self.assertTrue(any("retained legacy" in c.label for c in panel.controls))
        self.assertIn("not recommended", panel.embeds[0].description)

    async def test_background_refresh_retains_data_and_navigation_cancels(self):
        panel = self.controller.ui.tasks(self.agent.values["tasks"])
        refresh = self.controller.ui.loading("tasks", 1, panel)
        self.assertEqual(refresh.embeds[0].fields, panel.embeds[0].fields)
        self.assertIn("Refreshing", refresh.embeds[0].footer.text)
        task = self.controller.spawn(asyncio.sleep(100))
        self.controller.live[777] = task
        await self.controller.show(interaction(), "help")
        await asyncio.sleep(0)
        self.assertTrue(task.cancelled())

    async def test_beta_requires_confirmation_and_auto_schedule(self):
        item = interaction()
        await self.controller.dispatch(item, "channel", "beta")
        self.assertEqual(self.settings.read()["releaseChannel"], "stable")
        await self.controller.execute(interaction(), {"type": "beta"})
        self.assertEqual(self.settings.read()["autoUpdateMode"], "daily")
        self.assertTrue(self.settings.read()["betaAutoUpdateConfirmed"])
        await self.controller.dispatch(interaction(), "channel", "stable")
        self.assertEqual(self.settings.read()["autoUpdateMode"], "off")

    async def test_recovery_reads_v04_handoff_and_reports_once(self):
        recovery = self.controller.recovery
        recovery.stage("release", interaction(), "update", "0.5.0")
        recovery.accepted("release", {"job_id": "job-one", "version": "0.5.0"})
        self.agent.values["updates"]["bot"].update(
            {"job_id": "job-one", "phase": "complete", "current": "0.5.0"}
        )
        recovery.edit = AsyncMock(return_value=True)
        await recovery.resume("release")
        self.assertFalse(recovery.path("release").exists())
        self.assertIn("Complete", recovery.edit.call_args.args[1].embeds[0].description)
        await recovery.resume("release")
        self.assertEqual(recovery.edit.await_count, 1)

    async def test_recovery_refuses_version_mismatch(self):
        recovery = self.controller.recovery
        recovery.stage("release", interaction(), "update", "0.5.0")
        recovery.accepted("release", {"job_id": "job-one"})
        self.agent.values["updates"]["bot"].update(
            {"job_id": "job-one", "phase": "complete", "current": "0.3.19"}
        )
        recovery.edit = AsyncMock(return_value=True)
        await recovery.resume("release")
        self.assertIn("needs attention", recovery.edit.call_args.args[1].embeds[0].description)

    async def test_summary_and_media_data_semantics(self):
        panel = await self.controller.payload("updates", interaction())
        text = json.dumps(panel.embeds[0].to_dict())
        self.assertIn("Ubuntu 24.04", text)
        self.assertIn("Alpine Linux", text)
        self.assertNotIn("Host host", text)
        panel = await self.controller.payload("media", interaction())
        text = json.dumps(panel.embeds[0].to_dict())
        self.assertIn("S02", text)
        self.assertEqual(text.count("Test show"), 1)
        self.assertNotIn("Plex playback", text)
        self.assertIn("Incomplete", text)
        weekly = self.controller.ui.weekly(HOST, [SERVICE], [], {}, {"bot": RELEASE}, None)
        self.assertIn("Weekly Health", weekly.title)
        self.assertTrue(any(f.name == "Updates" for f in weekly.fields))

    async def test_native_payload_budget_and_process_only_status(self):
        panels = [
            self.controller.ui.storage(
                {
                    "storage": [
                        {
                            "label": "Long disk label " * 12,
                            "total": 100,
                            "used": 50,
                            "free": 50,
                            "percent": 50,
                        }
                        for _ in range(25)
                    ]
                }
            )
            for _ in range(2)
        ]
        combined = Panel([e for panel in panels for e in panel.embeds]).fit()
        self.assert_panel(combined)
        line = self.controller.ui.provider(
            {
                "label": "AdGuard",
                "online": True,
                "health_source": "docker",
                "probe_type": None,
                "latency_ms": 0,
            }
        )
        self.assertIn("Container running", line)
        self.assertNotIn("ms", line)
        guest = self.controller.ui.service_detail(SERVICE, False)
        self.assertFalse(any(c.key in {"logs", "service_action"} for c in guest.controls))

    async def test_loading_task_stops_before_final_result(self):
        event = asyncio.Event()

        async def operation():
            await event.wait()
            return "ready"

        item = interaction()
        task = asyncio.create_task(self.controller.with_loading(item, "tasks", operation()))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.assertTrue(item.edit_original_response.called)
        event.set()
        self.assertEqual(await task, "ready")
        count = item.edit_original_response.await_count
        await asyncio.sleep(0.01)
        self.assertEqual(item.edit_original_response.await_count, count)


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.requests = []

        async def handler(request):
            self.requests.append((request.path, dict(request.headers), await request.text()))
            if request.path == "/v1/redirect":
                raise web.HTTPFound("https://example.invalid")
            if request.path == "/api/v2/servers":
                return web.json_response({"data": [{"server_id": "srv", "server_name": "Test"}]})
            if request.path.endswith("/stats"):
                return web.json_response({"data": {"running": True, "cpu": 2.5, "memory": 1048576}})
            return web.json_response({"ok": True, "data": {"available": True}})

        app = web.Application()
        app.router.add_route("*", "/{tail:.*}", handler)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.base = f"http://127.0.0.1:{port}"
        self.cfg = config(
            Path(self.tmp.name),
            HOMELAB_CONTROL_AGENT_URL=self.base,
            CRAFTY_BASE_URL=self.base,
            CRAFTY_API_TOKEN="test-crafty-token",
        )
        self.session = aiohttp.ClientSession()

    async def asyncTearDown(self):
        await self.session.close()
        await self.runner.cleanup()
        self.tmp.cleanup()

    async def test_http_auth_audit_and_redirect_boundary(self):
        agent = Agent(self.cfg, self.session)
        await agent.get("updates", True, "beta")
        await agent.post("control-policy", interaction().user, {"mode": "opt-out"})
        self.assertEqual(self.requests[-1][1]["X-Homelab-Control-Token"], self.cfg.control_token)
        self.assertEqual(self.requests[-1][1]["X-Discord-User-ID"], OWNER)
        with self.assertRaises(ValueError):
            await agent.request("/v1/redirect")

    async def test_crafty_resources_and_console_routes(self):
        mc = Minecraft(self.cfg, self.session, None)
        servers = await mc.servers()
        self.assertEqual(servers[0]["resources"]["memory_used"], 1048576)
        self.assertTrue(servers[0]["running"])
        await mc.action("srv", "restart", interaction().user)
        await mc.command("srv", "say test")
        self.assertEqual(self.requests[-1][0], "/api/v2/servers/srv/stdin")
        self.assertEqual(self.requests[-1][1]["Authorization"], "Bearer test-crafty-token")
        for command in ("op user", "stop", "say hi\nstop", "whitelist off"):
            with self.assertRaises(ValueError):
                await mc.command("srv", command)


class PureTests(unittest.TestCase):
    def test_adaptive_units_and_meters(self):
        self.assertEqual(size(512), "512 B")
        self.assertEqual(size(1024), "1.0 KiB")
        self.assertEqual(size(1024**2), "1.0 MiB")
        self.assertEqual(size(None), "Size unavailable")
        self.assertEqual(bar(50).count("▰"), 5)

    def test_release_order_and_schedule_policy(self):
        versions = ["0.4.0-beta.2", "0.4.0-beta.10", "0.4.0", "0.4.0a", "0.4.0b", "0.4.1", "0.5.0"]
        self.assertEqual(sorted(reversed(versions), key=version_key), versions)
        release = {**RELEASE, "current": "0.4.0", "latest": "0.4.0a"}
        state = {
            "releaseChannel": "stable",
            "autoUpdateMode": "hotfix",
            "betaAutoUpdateConfirmed": False,
        }
        monday = datetime(2026, 10, 12, 4, tzinfo=UTC)
        sunday = datetime(2026, 10, 18, 4, tzinfo=UTC)
        self.assertTrue(allowed_release(release, state, monday))
        self.assertFalse(allowed_release(RELEASE, state, monday))
        self.assertFalse(allowed_release(RELEASE, {**state, "autoUpdateMode": "weekly"}, monday))
        self.assertTrue(allowed_release(RELEASE, {**state, "autoUpdateMode": "weekly"}, sunday))
        self.assertTrue(
            allowed_release(
                RELEASE,
                {**state, "releaseChannel": "beta", "betaAutoUpdateConfirmed": True},
                monday,
            )
        )

    def test_configuration_is_data_and_environment_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.env"
            path.write_text(
                "BOT_NAME=file name\nCRAFTY_API_TOKEN='file-token'\nNOT_A_SCRIPT=$(false)\n"
            )
            env = {"BOT_NAME": "environment name", "CRAFTY_API_TOKEN": ""}
            load_env(path, env)
            self.assertEqual(env["BOT_NAME"], "environment name")
            self.assertEqual(env["CRAFTY_API_TOKEN"], "file-token")
            self.assertEqual(env["NOT_A_SCRIPT"], "$(false)")

    def test_tls_default_and_public_certificate_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            self.assertTrue(crafty_tls(config(directory)).check_hostname)
            key = directory / "private.pem"
            key.write_text("-----BEGIN PRIVATE KEY-----\nnot-a-key\n")
            with self.assertRaises(ValueError):
                crafty_tls(config(directory, CRAFTY_CA_CERT_FILE=str(key)))
            self.assertIs(crafty_tls(config(directory, CRAFTY_ALLOW_INSECURE_TLS="true")), False)

    def test_redaction_and_wake_validation(self):
        secret = "secret-token-example"
        text = safe_error(
            "token=" + secret + " https://discord.com/api/webhooks/123/secret 192.0.2.1", [secret]
        )
        self.assertNotIn(secret, text)
        self.assertNotIn("192.0.2.1", text)
        self.assertEqual(normalise_mac("02:00:00:00:00:01"), "020000000001")
        with self.assertRaises(ValueError):
            normalise_mac("bad-input")

    def test_v041_worker_can_extract_python_release(self):
        import importlib.util

        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            old_source = subprocess.check_output(
                ["git", "show", "v0.4.1:maintenance/homelab-control-maintenance-worker.py"],
                cwd=ROOT,
            ).decode()
            module_file = directory / "old_worker.py"
            module_file.write_text(old_source)
            spec = importlib.util.spec_from_file_location("old_worker", module_file)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            archive = directory / "release.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                for relative in (
                    "agent/agent.py",
                    "agent/Dockerfile",
                    "bot/Dockerfile",
                    "bot/package.json",
                    "bot/package-lock.json",
                    "bot/requirements.txt",
                    "bot/homelab_bot/__init__.py",
                ):
                    tar.add(ROOT / relative, arcname=f"homelab-control-{__version__}/" + relative)
            extracted = module.safe_extract_release(archive, directory / "extracted")
            self.assertTrue((extracted / "bot/requirements.txt").is_file())


if __name__ == "__main__":
    unittest.main()
