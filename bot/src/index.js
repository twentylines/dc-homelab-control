import http from 'node:http';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { accessLevel, canUseCommand } from './access.js';
import { commandData, handleAutocomplete, handleCommand, handleComponent, handleModal } from './commands.js';
import { notifyMaintenanceOnline, startWeeklyReporter } from './weekly.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  for (const guildId of config.guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commandData });
      console.log(`Registered ${commandData.length} commands in guild ${guildId}`);
    } catch (error) {
      console.error(`Could not register commands in guild ${guildId}:`, error.message);
    }
  }
  console.log(`${config.botName} ready as ${ready.user.tag}; access configured for ${config.guildIds.length} guild(s)`);
  startWeeklyReporter();
  // Give the host bridge a moment to publish its post-boot status before the
  // one-shot online notification check. The state file prevents duplicates.
  setTimeout(() => notifyMaintenanceOnline().catch(() => {}), 12_000).unref?.();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isAutocomplete() && !interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
  if (accessLevel(interaction) === 'none' || (interaction.isChatInputCommand() && !canUseCommand(interaction))) {
    if (interaction.isAutocomplete()) {
      await interaction.respond([]);
      return;
    }
    const response = { content: 'This private control panel is restricted to the configured administrator and guest whitelists.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response); else await interaction.reply(response);
    return;
  }
  if (interaction.isAutocomplete()) await handleAutocomplete(interaction);
  else if (interaction.isChatInputCommand()) await handleCommand(interaction);
  else if (interaction.isModalSubmit()) await handleModal(interaction);
  else await handleComponent(interaction);
});

client.on(Events.Error, (error) => console.error('Discord client error:', error.message));
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error?.message || error));

http.createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(client.isReady() ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: client.isReady() }));
    return;
  }
  response.writeHead(404).end();
}).listen(config.healthPort, '0.0.0.0');

await client.login(config.discordToken);
