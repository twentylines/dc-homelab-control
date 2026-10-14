import asyncio
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiohttp
from aiohttp import web
from test_bot import OWNER, ROOT, FixtureCase, config, interaction

from homelab_bot.main import HomelabBot
from homelab_bot.minecraft import Minecraft
from homelab_bot.scheduler import Scheduler
from homelab_bot.state import read_json


class Workflows(FixtureCase):
    async def test_confirmed_release_handoff_written_before_queue(self):
        async def queue(*args, **kwargs):
            state = read_json(self.controller.recovery.path("release"))
            self.assertEqual(state["target"], "0.5.0")
            self.assertEqual(state["application_id"], OWNER)
            return {"job_id": "queued-job", "version": "0.5.0"}

        self.agent.post.side_effect = queue
        self.controller.recovery.resume = AsyncMock()
        item = interaction()
        await self.controller.execute(
            item, {"type": "release", "action": "update", "target": "0.5.0"}
        )
        state = read_json(self.controller.recovery.path("release"))
        self.assertEqual(state["job_id"], "queued-job")
        self.assertEqual(self.agent.post.call_args.args[0], "bot-release/update")
        await asyncio.sleep(0)
        self.controller.recovery.resume.assert_awaited_once_with("release")

    async def test_host_reboot_handoff_and_legacy_id_retained(self):
        self.controller.recovery.resume = AsyncMock()
        self.agent.post.return_value = {"accepted": True}
        await self.controller.execute(interaction(), {"type": "host_reboot", "job_id": "host-job"})
        state = read_json(self.controller.recovery.path("host"))
        self.assertEqual(state["job_id"], "host-job")
        self.assertEqual(self.agent.post.call_args.args[0], "system-updates/reboot?job_id=host-job")

    async def test_minecraft_mutation_and_console_submit(self):
        await self.controller.execute(
            interaction(), {"type": "minecraft", "id": "server-one", "action": "restart"}
        )
        self.mc.action.assert_awaited_once()
        await self.controller.submit(interaction(), "console", "server-one", "say test")
        self.mc.command.assert_awaited_once_with("server-one", "say test")

    async def test_all_recovery_routes(self):
        endpoints = {
            "restart": "bot-release/restart",
            "reset": "settings/reset",
            "restore": "settings/restore",
            "fix-preserve": "bot-release/repair",
            "fix-fresh": "bot-release/repair",
        }
        self.controller.recovery.resume = AsyncMock()
        for action, endpoint in endpoints.items():
            await self.controller.execute(interaction(), {"type": "maintenance", "action": action})
            self.assertEqual(self.agent.post.call_args.args[0], endpoint)

    async def test_confirmed_rollback_exact_version_and_retained_source(self):
        self.controller.recovery.resume = AsyncMock()
        for selected in ("0.4.0d", ""):
            await self.controller.execute(
                interaction(),
                {
                    "type": "release",
                    "action": "rollback",
                    "target": "0.4.0d",
                    "selected_version": selected,
                },
            )
            self.assertEqual(self.agent.post.call_args.args[0], "bot-release/rollback")
            self.assertEqual(self.agent.post.call_args.args[2]["selected_version"], selected)

    async def test_scheduler_off_does_not_install(self):
        scheduler = Scheduler(self.controller)
        self.controller.scheduler = scheduler
        await scheduler.tick(datetime(2026, 10, 12, 4, 1, tzinfo=UTC))
        self.agent.post.assert_not_awaited()

    async def test_scheduler_daily_queues_once_and_notice_is_one_shot(self):
        scheduler = Scheduler(self.controller)
        self.controller.scheduler = scheduler
        self.settings.update(autoUpdateMode="daily", autoUpdateHour=4)
        when = datetime(2026, 10, 12, 4, 1, tzinfo=UTC)
        await scheduler.tick(when)
        await scheduler.tick(when)
        self.assertEqual(self.agent.post.await_count, 1)
        self.agent.values["updates"]["bot"].update(
            {
                "phase": "complete",
                "job_id": "job-one",
                "current": "0.5.0",
                "automatic": True,
                "update_available": False,
            }
        )
        await scheduler.tick(when)
        self.assertEqual(self.settings.read()["postUpdateNotice"]["version"], "0.5.0")
        first, second = interaction(component=False), interaction(component=False)
        first.message, second.message = None, None
        await self.controller.show(first, "help", notice=True)
        await self.controller.show(second, "help", notice=True)
        self.assertEqual(len(first.edit_original_response.call_args.kwargs["embeds"]), 2)
        self.assertEqual(len(second.edit_original_response.call_args.kwargs["embeds"]), 1)

    async def test_weekly_summary_posts_once(self):
        scheduler = Scheduler(self.controller)
        scheduler.post = AsyncMock(return_value=True)
        when = datetime(2026, 10, 18, 20, 1, tzinfo=UTC)
        await scheduler.tick(when)
        await scheduler.tick(when)
        scheduler.post.assert_awaited_once()
        embed = scheduler.post.call_args.args[0]
        self.assertIn("Weekly Health", embed.title)
        self.assertTrue(any(f.name == "Updates" for f in embed.fields))


class Runtime(unittest.IsolatedAsyncioTestCase):
    async def test_real_health_endpoint_and_command_setup(self):
        with tempfile.TemporaryDirectory() as tmp:
            bot = HomelabBot(config(Path(tmp), HEALTH_PORT="30199"))
            bot.tree.sync = AsyncMock(return_value=[])
            try:
                await bot.setup_hook()
                bot.tree.sync.assert_awaited_once()
                async with aiohttp.ClientSession() as session:
                    async with session.get("http://127.0.0.1:30199/healthz") as response:
                        self.assertEqual(response.status, 503)
                        self.assertEqual((await response.json())["version"], "0.5.0")
                    with patch.object(bot, "is_ready", return_value=True):
                        async with session.get("http://127.0.0.1:30199/healthz") as response:
                            self.assertEqual(response.status, 200)
                            self.assertEqual((await response.json())["runtime"], "discord.py")
                    item = interaction()
                    item.data = {"custom_id": "hc:expired:0"}
                    await bot.on_interaction(item)
                    item.response.send_message.assert_awaited_once()
            finally:
                await bot.close()

    async def test_exact_legacy_health_probe_succeeds_and_fails_honestly(self):
        probe = "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
        healthy = True

        async def health(request):
            return web.json_response({"ok": healthy}, status=200 if healthy else 503)

        app = web.Application()
        app.router.add_get("/healthz", health)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", 3000).start()
        try:
            for expected in (0, 1):
                process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    str(ROOT / "bot/legacy_healthcheck.py"),
                    "-e",
                    probe,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                self.assertEqual(await process.wait(), expected)
                healthy = False
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                str(ROOT / "bot/legacy_healthcheck.py"),
                "-e",
                "arbitrary code",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            self.assertNotEqual(await process.wait(), 0)
        finally:
            await runner.cleanup()

    async def test_pterodactyl_and_pelican_pagination_and_controls(self):
        with tempfile.TemporaryDirectory() as tmp:
            async with aiohttp.ClientSession() as session:
                await self.check_panel_backends(tmp, session)

    async def check_panel_backends(self, tmp, session):
        for backend in ("pterodactyl", "pelican"):
            cfg = config(
                Path(tmp),
                MINECRAFT_BACKEND=backend,
                **{
                    backend.upper() + "_BASE_URL": "https://panel.example.invalid",
                    backend.upper() + "_API_TOKEN": "fixture-only",
                },
            )
            mc = Minecraft(cfg, session, None)

            async def request(panel, path, **kwargs):
                if path.startswith("/api/client?page="):
                    page = int(path.rsplit("=", 1)[1])
                    return {
                        "data": [
                            {
                                "attributes": {
                                    "identifier": "srv" + str(page),
                                    "name": "Test " + str(page),
                                }
                            }
                        ],
                        "meta": {"pagination": {"total_pages": 2}},
                    }
                if path.endswith("/resources"):
                    return {
                        "attributes": {
                            "current_state": "running",
                            "resources": {"cpu_absolute": 12.5, "memory_bytes": 2048},
                        }
                    }
                return {}

            mc.request = AsyncMock(side_effect=request)
            servers = await mc.servers()
            self.assertEqual(len(servers), 2)
            self.assertEqual(servers[0]["resources"]["cpu_percent"], 12.5)
            await mc.action("srv1", "restart", interaction().user)
            self.assertEqual(mc.request.call_args.args[1], "/api/client/servers/srv1/power")
            await mc.action("srv1", "backup", interaction().user)
            self.assertEqual(mc.request.call_args.args[1], "/api/client/servers/srv1/backups")
