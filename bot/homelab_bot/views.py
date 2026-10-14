from __future__ import annotations

import secrets
import time

import discord

from .ui import Control, navigation


class PanelView(discord.ui.View):
    def __init__(self, controller, controls, *, owner=None, timeout=840):
        super().__init__(timeout=timeout)
        self.controller, self.owner = controller, owner
        row, width = 0, 0
        self.nonce = secrets.token_hex(6)
        controller.active_views.add(self.nonce)
        for index, control in enumerate(controls):
            if control.options:
                if width:
                    row, width = row + 1, 0
                item = discord.ui.Select(
                    custom_id=f"hc:{self.nonce}:{index}",
                    placeholder=control.label[:150],
                    options=[
                        discord.SelectOption(
                            label=label[:100],
                            value=str(value)[:100],
                            description=description[:100] or None,
                        )
                        for label, value, description in control.options[:25]
                    ],
                    row=row,
                )
                row += 1
            else:
                if width == 5:
                    row, width = row + 1, 0
                item = discord.ui.Button(
                    custom_id=f"hc:{self.nonce}:{index}",
                    label=control.label[:80],
                    style=control.style,
                    row=row,
                )
                width += 1
            if item.row > 4:
                raise ValueError("Panel exceeds Discord's five-row limit")

            async def callback(interaction, definition=control, widget=item):
                value = (
                    widget.values[0] if isinstance(widget, discord.ui.Select) else definition.value
                )
                await controller.dispatch(interaction, definition.key, value)

            item.callback = callback
            self.add_item(item)

    async def interaction_check(self, interaction):
        try:
            level = self.controller.settings.access(interaction)
        except ValueError:
            level = "none"
        if level == "none" or (self.owner is not None and interaction.user.id != self.owner):
            await interaction.response.send_message(
                "This control is restricted to its authorised user.", ephemeral=True
            )
            return False
        return True

    async def on_error(self, interaction, error, item):
        await self.controller.fail(interaction, error)

    async def on_timeout(self):
        self.controller.active_views.discard(self.nonce)


class Confirmation(PanelView):
    def __init__(self, controller, user_id, action, panel):
        controls = [
            Control("Confirm", "confirm", None, discord.ButtonStyle.danger),
            Control("Cancel", "cancel"),
            Control("Back to home", "page", "panel"),
        ]
        super().__init__(controller, controls, owner=user_id, timeout=60)
        self.action, self.expires, self.used = action, time.monotonic() + 60, False
        for item, key in zip(self.children, ("confirm", "cancel", "home")):

            async def callback(interaction, choice=key):
                if self.used or time.monotonic() >= self.expires:
                    await interaction.response.send_message(
                        "Confirmation expired. Request the action again.", ephemeral=True
                    )
                    return
                self.used = True
                self.stop()
                if choice == "home":
                    await controller.show(interaction, "panel")
                elif choice == "cancel":
                    await interaction.response.edit_message(
                        embeds=[controller.ui.embed("Cancelled", "No action was taken.")],
                        view=PanelView(controller, navigation("updates")),
                    )
                else:
                    await controller.execute(interaction, self.action)

            item.callback = callback


class InputModal(discord.ui.Modal):
    def __init__(self, controller, key, value=None):
        title = "Minecraft console" if key == "console" else "Add authorised user"
        super().__init__(title=title, timeout=180)
        self.controller, self.key, self.value = controller, key, value
        self.entry = discord.ui.TextInput(
            label="Command (no leading slash)" if key == "console" else "Discord user ID",
            max_length=200 if key == "console" else 25,
            required=True,
        )
        self.add_item(self.entry)

    async def on_submit(self, interaction):
        await self.controller.submit(interaction, self.key, self.value, str(self.entry))

    async def on_error(self, interaction, error):
        await self.controller.fail(interaction, error)
