from __future__ import annotations

import asyncio
import logging

import aiohttp
import discord
from aiohttp import web
from discord import app_commands

from . import __version__
from .api import Agent
from .config import Config
from .controller import Controller
from .minecraft import Minecraft
from .scheduler import Scheduler
from .state import Settings
from .ui import Renderer, clean, navigation
from .views import PanelView

DESCRIPTIONS = {
    "panel": "Open your homelab home panel",
    "status": "Show host and container status",
    "services": "Inspect and manage detected containers",
    "minecraft": "Inspect Minecraft servers and their resources",
    "media": "Show detected media services and playback",
    "storage": "Show storage capacity and drive health",
    "tasks": "Show container CPU, RAM and processes",
    "network": "Check DNS providers and network connectivity",
    "controls": "Review which containers administrators can control",
    "health": "Show a concise homelab health summary",
    "report": "Generate a detailed homelab report",
    "audit": "Show recent controller actions",
    "updates": "Review and install host, app and bot updates",
    "help": "Show the command guide",
    "ping": "Measure Discord and controller response time",
}


class CommandTree(app_commands.CommandTree):
    async def interaction_check(self, interaction):
        try:
            allowed = self.client.controller.settings.access(interaction) != "none"
        except (ValueError, OSError):
            allowed = False
        if not allowed:
            await interaction.response.send_message(
                "Access is restricted to configured Discord users and roles.", ephemeral=True
            )
        return allowed

    async def on_error(self, interaction, error):
        await self.client.controller.fail(interaction, getattr(error, "original", error))


class HomelabBot(discord.Client):
    def __init__(self, cfg):
        super().__init__(
            intents=discord.Intents(guilds=True), allowed_mentions=discord.AllowedMentions.none()
        )
        self.cfg = cfg
        self.tree = CommandTree(self)
        self.session = self.runner = self.controller = None
        self.started = False
        for name, description in DESCRIPTIONS.items():
            self.tree.add_command(self.reader(name, description))

        @self.tree.command(
            name="settings", description="Manage access, automatic updates and recovery"
        )
        @app_commands.guild_only()
        async def settings(interaction: discord.Interaction):
            await self.controller.show(interaction, "settings")

        @self.tree.command(name="wake", description="Send Wake-on-LAN to a trusted device")
        @app_commands.guild_only()
        async def wake(
            interaction: discord.Interaction,
            mac: str | None = None,
            broadcast: str | None = None,
            label: str | None = None,
            favourite: str | None = None,
        ):
            await interaction.response.defer(ephemeral=True, thinking=True)
            try:
                if mac and favourite:
                    raise ValueError("Choose a favourite or a MAC address")
                values = self.controller.wake.favorites()
                match = next(
                    (v for k, v in values.items() if k.lower() == (favourite or "").lower()), None
                )
                if favourite and not match:
                    raise ValueError("Wake favourite was not found")
                target = mac or (match or {}).get("mac")
                if not target:
                    raise ValueError("Choose a favourite or enter a MAC address")
                destination = broadcast or (match or {}).get("broadcast")
                await self.controller.wake.send(target, destination)
                if (
                    mac
                    and label
                    and self.controller.settings.access(interaction) in {"admin", "superuser"}
                ):
                    self.controller.wake.save(label, mac, destination)
                e = self.controller.ui.embed(
                    "Wake signal sent",
                    "Packet sent to **"
                    + clean(label or favourite or "the selected device")
                    + "**. The device may take a moment to start.",
                    kind="ok",
                )
                await interaction.edit_original_response(
                    embeds=[e], view=PanelView(self.controller, navigation("wake"))
                )
            except (ValueError, OSError) as exc:
                await self.controller.fail(interaction, exc)

        @wake.autocomplete("favourite")
        async def wake_favourites(interaction, current):
            try:
                if self.controller.settings.access(interaction) == "none":
                    return []
                return [
                    app_commands.Choice(name=name[:100], value=name)
                    for name in self.controller.wake.favorites()
                    if current.lower() in name.lower()
                ][:25]
            except (ValueError, OSError):
                return []

    def reader(self, page, description):
        @app_commands.guild_only()
        @app_commands.describe(public="Share this status panel with the channel")
        async def callback(interaction: discord.Interaction, public: bool = False):
            await self.controller.show(interaction, page, public=public, notice=True)

        return app_commands.Command(name=page, description=description, callback=callback)

    async def setup_hook(self):
        self.session = aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=24))
        agent, settings, ui = Agent(self.cfg, self.session), Settings(self.cfg), Renderer(self.cfg)
        self.controller = Controller(
            self.cfg, settings, agent, Minecraft(self.cfg, self.session, agent), ui, self.session
        )
        self.controller.scheduler = Scheduler(self.controller)
        app = web.Application()

        async def health(_request):
            return web.json_response(
                {"ok": self.is_ready(), "version": __version__, "runtime": "discord.py"},
                status=200 if self.is_ready() else 503,
                headers={"Cache-Control": "no-store"},
            )

        app.router.add_get("/healthz", health)
        self.runner = web.AppRunner(app, access_log=None)
        await self.runner.setup()
        await web.TCPSite(
            self.runner, "0.0.0.0", self.cfg.integer("HEALTH_PORT", 3000, 1, 65535)
        ).start()
        for guild_id in self.cfg.guild_ids:
            guild = discord.Object(id=int(guild_id))
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)

    async def on_ready(self):
        logging.getLogger(__name__).info(
            "%s %s connected using discord.py", self.cfg.bot_name, __version__
        )
        if not self.started:
            self.started = True

            async def recovery():
                await asyncio.sleep(8)
                await self.controller.recovery.resume_all()

            self.controller.spawn(recovery())
            self.controller.spawn(self.controller.scheduler.run())

    async def on_interaction(self, interaction):
        data = interaction.data or {}
        identity = str(data.get("custom_id", ""))
        if interaction.type == discord.InteractionType.component and identity.startswith("nav:"):
            await self.controller.show(interaction, identity.split(":", 1)[1])
        elif interaction.type == discord.InteractionType.component and not identity.startswith(
            "hc:"
        ):
            await interaction.response.send_message(
                "This panel belongs to an older release. Open /panel to use the new controls.",
                ephemeral=True,
            )

        elif (
            interaction.type == discord.InteractionType.component
            and identity.split(":")[1] not in self.controller.active_views
        ):
            await interaction.response.send_message(
                "This panel expired or the bot restarted. Open /panel to continue.", ephemeral=True
            )

    async def close(self):
        if self.controller:
            await self.controller.close()
        if self.runner:
            await self.runner.cleanup()
        if self.session:
            await self.session.close()
        await super().close()


def main():
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    logging.getLogger("discord.http").setLevel(logging.WARNING)
    cfg = Config.load()

    async def run():
        async with HomelabBot(cfg) as bot:
            await bot.start(cfg.get("DISCORD_TOKEN"))

    asyncio.run(run())


if __name__ == "__main__":
    main()
