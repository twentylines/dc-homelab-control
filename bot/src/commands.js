import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { agent } from './agent.js';
import { isAdmin } from './access.js';
import { crafty } from './crafty.js';
import { config } from './config.js';
import { favoriteNames, getFavorite, saveFavorite } from './favorites.js';
import { wakeDevice } from './wol.js';
import {
  actionLoadingEmbed, base, bytes, colors, errorEmbed, loadingEmbed, mediaEmbed, minecraftEmbed, minecraftRows,
  controlsEmbed, controlsRows, healthEmbed, networkEmbed, panelEmbed, panelRows, reportEmbeds, serviceRows, servicesEmbed, statusEmbed, storageEmbed,
  botReleaseLoadingEmbed, botReleaseResultEmbed, systemUpdateLoadingEmbed, systemUpdateResultEmbed, taskDetailEmbed, tasksEmbed, tasksLoadingEmbed, tasksRows, updateLoadingEmbed, updateResultEmbed, updateResultRows, updatesEmbed, updatesRows,
} from './ui.js';
import { notifyMaintenanceEvent } from './weekly.js';

export const commandData = [
  new SlashCommandBuilder().setName('panel').setDescription('Open the homelab control panel')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('status').setDescription('Show live system status')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('services').setDescription('Inspect and manage detected services')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('minecraft').setDescription('Inspect and manage Minecraft servers')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('media').setDescription('Check detected media services')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('storage').setDescription('Show capacity and SMART drive health')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('tasks').setDescription('Show live Docker resource usage')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('network').setDescription('Check detected DNS and network services')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('controls').setDescription('Configure administrator controls for detected containers'),
  new SlashCommandBuilder().setName('health').setDescription('Run a concise homelab health check')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('report').setDescription('Generate a detailed homelab health report')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
  new SlashCommandBuilder().setName('updates').setDescription('Check and safely manage homelab and bot updates')
    .addBooleanOption((option) => option.setName('public').setDescription('Post the update status for everyone in this channel')),
  new SlashCommandBuilder().setName('wake').setDescription('Send a Wake-on-LAN packet to any trusted device')
    .addStringOption((option) => option.setName('mac').setDescription('Target device MAC address (or choose a favourite)'))
    .addStringOption((option) => option.setName('broadcast').setDescription('IPv4 broadcast address (optional)'))
    .addStringOption((option) => option.setName('label').setDescription('Friendly device label (optional)'))
    .addStringOption((option) => option.setName('favourite').setDescription('Use a saved favourite').setAutocomplete(true)),
  new SlashCommandBuilder().setName('audit').setDescription('Show recent control actions')
    .addBooleanOption((option) => option.setName('public').setDescription('Post for everyone in this channel')),
].map((command) => command.toJSON());

const confirmations = new Map();
const TTL = 60_000;
const tasksLiveSessions = new Map();
const TASKS_LIVE_DURATION_MS = 65_000;
const TASKS_LIVE_INTERVAL_MS = 5_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const loadingProfiles = {
  panel: {
    steps: ['Request sent to the control agent', 'Waiting for host, service and media checks', 'Formatting the control-centre view'],
    detail: 'Read-only request · no service changes are being made',
  },
  health: {
    steps: ['Request sent to the control agent', 'Waiting for host, service and media checks', 'Formatting the diagnostic result'],
    detail: 'Read-only diagnostic · no service changes are being made',
  },
  report: {
    steps: ['Request sent to the control agent', 'Waiting for host, media, audit and update checks', 'Formatting the detailed report'],
    detail: 'Read-only report · no service changes are being made',
  },
  media: {
    steps: ['Request sent to the control agent', 'Checking media endpoints, Jellyfin and media-container resources', 'Reading the library volume and formatting the media view'],
    detail: 'Read-only media check · no playback or library changes are being made',
  },
  network: {
    steps: ['Request sent to the control agent', 'Discovering DNS and network providers', 'Formatting the network view'],
    detail: 'Read-only network check · no DNS or routing changes are being made',
  },
  updates: {
    steps: ['Request sent to the Runtipi, Ubuntu and GitHub status readers', 'Waiting for catalogue, host and release responses', 'Preparing verified update controls'],
    detail: 'Read-only update check · no update action is being attempted',
  },
  tasks: {
    steps: ['Request sent to the Docker resource reader', 'Docker is sampling CPU, memory, processes and network counters', 'Grouping the returned containers by workload'],
    detail: 'Read-only Docker stats · no container action is being attempted',
  },
  default: {
    steps: ['Request sent to the control agent', 'Waiting for the requested snapshot', 'Formatting the returned data'],
    detail: 'Read-only request · no service changes are being made',
  },
};

async function beginLoadingAnimation(interaction, title, profileName = 'default') {
  const profile = loadingProfiles[profileName] || loadingProfiles.default;
  const started = Date.now();
  let tick = 0;
  let active = true;
  let rendering = false;
  const render = async () => {
    if (!active || rendering) return;
    rendering = true;
    try {
      // Stage one is deliberately held while the remote call is in flight;
      // the bot cannot honestly claim that formatting has started until the
      // response has arrived.
      const stage = Math.min(1, Math.floor(tick / 2));
      await interaction.editReply({ embeds: [loadingEmbed(title, stage, tick, {
        steps: profile.steps,
        elapsedSeconds: (Date.now() - started) / 1000,
        phase: tick ? 'Still working' : 'Request sent',
        detail: profile.detail,
      })], components: [] });
    } catch {
      // The final result still wins if Discord closes or replaces the message.
    } finally {
      rendering = false;
    }
  };
  await render();
  const animation = (async () => {
    while (active) {
      await delay(1200);
      if (!active) break;
      tick += 1;
      await render();
    }
  })().catch(() => {});
  return async () => {
    active = false;
    await animation;
  };
}

function nonce() { return randomBytes(8).toString('hex'); }

function confirmRows(id) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm:${id}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cancel:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  )];
}

function stageConfirmation(userId, payload) {
  const id = nonce();
  confirmations.set(id, { ...payload, userId, expires: Date.now() + TTL });
  return id;
}

function serviceDetail(service, allowActions = true) {
  const failed = service.state !== 'running' || ['unhealthy', 'unreachable'].includes(service.health);
  const source = service.discovered ? 'Auto-detected from the live Docker catalogue' : 'Recognised service';
  const detail = service.health_detail || service.status || 'No additional status detail returned';
  return base(service.label, `${failed ? '🔴' : '🟢'} **${service.state}** · **${service.health || 'unknown'}**\n${detail}`)
    .setColor(failed ? colors.warn : colors.ok)
    .addFields(
      { name: 'Container', value: service.container || 'not present', inline: true },
      { name: 'Source', value: source, inline: true },
      { name: 'Protection', value: !allowActions ? 'Read-only guest view' : service.manageable ? 'Control enabled • confirmation required' : 'Read-only container view' },
    );
}

function serviceActionRows(service, allowActions = true) {
  const buttons = [];
  if (allowActions && service.manageable) {
    if (service.state !== 'running') buttons.push(new ButtonBuilder().setCustomId(`service-action:${service.key}:start`).setLabel('Start').setEmoji('▶️').setStyle(ButtonStyle.Success));
    if (service.state === 'running') buttons.push(new ButtonBuilder().setCustomId(`service-action:${service.key}:restart`).setLabel('Restart').setEmoji('🔄').setStyle(ButtonStyle.Primary));
    if (service.state === 'running') buttons.push(new ButtonBuilder().setCustomId(`service-action:${service.key}:stop`).setLabel('Stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger));
  }
  buttons.push(new ButtonBuilder().setCustomId(`service-logs:${service.key}`).setLabel('Recent logs').setEmoji('📜').setStyle(ButtonStyle.Secondary));
  return [new ActionRowBuilder().addComponents(buttons)];
}

function cleanMinecraftText(value, maximum = 180) {
  return String(value || 'Unknown').replace(/[\\`*_~|\r\n@]/g, '').slice(0, maximum);
}

function mcDetail(server) {
  const resources = server.resources || {};
  const cpu = Number.isFinite(Number(resources.cpu_percent)) ? `${Number(resources.cpu_percent).toFixed(1)}%` : 'Not reported';
  const memory = Number.isFinite(Number(resources.memory_used))
    ? `${bytes(resources.memory_used)}${Number.isFinite(Number(resources.memory_limit)) ? ` / ${bytes(resources.memory_limit)}` : ''}`
    : 'Not reported';
  const pids = Number.isFinite(Number(resources.pids)) ? Number(resources.pids).toLocaleString('en-GB') : 'Not reported';
  const resourceError = server.resource_error ? `\n⚪ Resource sample unavailable · ${cleanMinecraftText(server.resource_error, 160)}` : '';
  const status = server.running ? '🟢 Online' : server.state === 'unknown' ? '⚪ Status unknown' : '⚫ Offline';
  return base(cleanMinecraftText(server.name, 100), `${status}\n${cleanMinecraftText(server.type, 80)} • ${cleanMinecraftText(server.version, 120)}${resourceError}`)
    .setColor(server.running ? colors.ok : colors.idle)
    .addFields(
      { name: 'Server ID', value: `\`${cleanMinecraftText(server.id, 100)}\`` },
      { name: 'Resources', value: `**CPU** ${cpu}\n**RAM** ${memory}\n**Processes** ${pids} PIDs`, inline: true },
      { name: 'Panel', value: server.panel || 'Minecraft backend', inline: true },
    );
}

function mcActionRows(server, allowActions = true) {
  const primary = [];
  const canManage = allowActions && server.manageable !== false && server.protected !== true;
  if (canManage && !server.running) primary.push(new ButtonBuilder().setCustomId(`mc-action:${server.id}:start`).setLabel('Start').setEmoji('▶️').setStyle(ButtonStyle.Success));
  if (canManage && server.running) {
    primary.push(new ButtonBuilder().setCustomId(`mc-action:${server.id}:restart`).setLabel('Restart').setEmoji('🔄').setStyle(ButtonStyle.Primary));
    primary.push(new ButtonBuilder().setCustomId(`mc-action:${server.id}:stop`).setLabel('Stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger));
    primary.push(new ButtonBuilder().setCustomId(`mc-console:${server.id}`).setLabel('Console').setEmoji('⌨️').setStyle(ButtonStyle.Secondary));
  }
  if (canManage) primary.push(new ButtonBuilder().setCustomId(`mc-action:${server.id}:backup`).setLabel('Backup').setEmoji('💾').setStyle(ButtonStyle.Secondary));
  return primary.length ? [new ActionRowBuilder().addComponents(primary)] : [];
}

async function statusPayload() {
  const data = await agent.status();
  return { embeds: [statusEmbed(data)], components: panelRows() };
}

async function panelPayload() {
  const [data, services, media, updates, mediaSummary] = await Promise.all([
    agent.status(),
    agent.services(),
    agent.media(),
    agent.updates().catch((error) => ({ available: false, detail: error.message })),
    agent.mediaSummary().catch(() => null),
  ]);
  return { embeds: [panelEmbed(data, services, media, updates, mediaSummary)], components: panelRows() };
}

async function healthPayload() {
  const [data, services, media, mediaSummary] = await Promise.all([agent.status(), agent.services(), agent.media(), agent.mediaSummary().catch(() => null)]);
  return { embeds: [healthEmbed(data, services, media, mediaSummary)], components: panelRows() };
}

async function mediaPayload() {
  const [media, playback, hostStatus, resources, summary, plex] = await Promise.all([
    agent.media(),
    agent.jellyfin(),
    agent.status().catch(() => null),
    agent.mediaResources().catch(() => null),
    agent.mediaSummary().catch(() => null),
    agent.plex().catch(() => null),
  ]);
  return { embeds: [mediaEmbed(media, playback, hostStatus, resources, summary, plex)], components: panelRows() };
}

async function servicesPayload() {
  const services = await agent.services();
  return { embeds: [servicesEmbed(services)], components: serviceRows(services) };
}

async function networkPayload() {
  const [network, summary, status] = await Promise.all([
    agent.network(),
    agent.networkSummary().catch(() => null),
    agent.status().catch(() => ({})),
  ]);
  return { embeds: [networkEmbed(network, summary, status)], components: panelRows() };
}

async function controlsPayload(page = 0) {
  const [services, policy] = await Promise.all([agent.services(), agent.controlPolicy()]);
  return { embeds: [controlsEmbed(services, policy, { page })], components: controlsRows(services, policy, { page }) };
}

function stopTasksLive(messageId) {
  const session = tasksLiveSessions.get(messageId);
  if (!session) return;
  session.active = false;
  tasksLiveSessions.delete(messageId);
}

function startTasksLive(interaction, messageId, initialSnapshot = null) {
  if (!messageId) return;
  stopTasksLive(messageId);
  const session = { active: true, messageId };
  tasksLiveSessions.set(messageId, session);
  (async () => {
    const deadline = Date.now() + TASKS_LIVE_DURATION_MS;
    let tick = 0;
    let lastSnapshot = initialSnapshot;
    try {
      while (session.active && Date.now() < deadline) {
        await delay(TASKS_LIVE_INTERVAL_MS);
        if (!session.active || Date.now() >= deadline) break;
        tick += 1;
        const snapshot = await sampleTasksWithBackgroundRefresh(interaction, session, lastSnapshot, tick);
        // A button click may have replaced this view while Docker was being
        // sampled. Never let an old live loop overwrite the newer view.
        if (!session.active || tasksLiveSessions.get(messageId) !== session) return;
        lastSnapshot = snapshot;
        await interaction.editReply({
          embeds: [tasksEmbed(snapshot, { live: true, tick })],
          components: tasksRows(snapshot, true),
        });
      }
      if (!session.active || tasksLiveSessions.get(messageId) !== session) return;
      const finalPayload = lastSnapshot
        ? { embeds: [tasksEmbed(lastSnapshot, { ended: true })], components: tasksRows(lastSnapshot, false) }
        : await tasksPayload(false, false, 0, true);
      if (!session.active || tasksLiveSessions.get(messageId) !== session) return;
      await interaction.editReply(finalPayload);
    } catch (error) {
      if (tasksLiveSessions.get(messageId) === session) {
        console.warn('Task live view stopped:', error?.message || error);
      }
    } finally {
      if (tasksLiveSessions.get(messageId) === session) tasksLiveSessions.delete(messageId);
      session.active = false;
    }
  })();
}

async function tasksSnapshotPayload(force = false, live = false, tick = 0, ended = false, options = {}) {
  const snapshot = await agent.tasks(force);
  return {
    snapshot,
    payload: { embeds: [tasksEmbed(snapshot, { live, tick, ended, ...options })], components: tasksRows(snapshot, live) },
  };
}

async function tasksPayload(force = false, live = false, tick = 0, ended = false) {
  return (await tasksSnapshotPayload(force, live, tick, ended)).payload;
}

async function withTasksLoading(interaction, operation, shouldRender = () => true) {
  let active = true;
  let frame = 0;
  const started = Date.now();
  if (shouldRender()) await interaction.editReply({ embeds: [tasksLoadingEmbed(frame, 0)], components: [] });
  const animation = (async () => {
    while (active) {
      await delay(1200);
      if (!active) break;
      frame += 1;
      if (shouldRender()) await interaction.editReply({ embeds: [tasksLoadingEmbed(frame, (Date.now() - started) / 1000)], components: [] });
    }
  })().catch(() => {});
  try {
    return await operation();
  } finally {
    active = false;
    await animation;
  }
}

async function tasksPayloadWithLoading(interaction, force = false, live = false, tick = 0, ended = false, shouldRender = () => true) {
  return withTasksLoading(interaction, () => tasksSnapshotPayload(force, live, tick, ended), shouldRender);
}

async function sampleTasksWithBackgroundRefresh(interaction, session, lastSnapshot, tick) {
  if (!lastSnapshot) return agent.tasks(true);
  const started = Date.now();
  let frame = 0;
  let active = true;
  let rendering = false;
  const shouldRender = () => session.active && tasksLiveSessions.get(session.messageId) === session;
  const renderFooter = async () => {
    if (!active || !shouldRender() || rendering) return;
    rendering = true;
    try {
      await interaction.editReply({
        embeds: [tasksEmbed(lastSnapshot, {
          live: true,
          tick,
          refreshing: true,
          refreshTick: frame,
          refreshElapsedSeconds: (Date.now() - started) / 1000,
        })],
        components: tasksRows(lastSnapshot, true),
      });
    } catch {
      // The completed sample or a newer interaction view still wins.
    } finally {
      rendering = false;
    }
  };
  await renderFooter();
  const animation = (async () => {
    while (active) {
      await delay(1200);
      if (!active) break;
      frame += 1;
      await renderFooter();
    }
  })().catch(() => {});
  try {
    return await agent.tasks(true);
  } finally {
    active = false;
    await animation;
  }
}

async function minecraftPayload() {
  const servers = await crafty.servers();
  if (!servers.length) return { embeds: [base('Minecraft', 'No supported Minecraft panel or Docker server was detected. Configure Crafty, Pterodactyl/Pelican, or start a Minecraft container to have it appear automatically.').setColor(colors.idle)], components: [] };
  return { embeds: [minecraftEmbed(servers)], components: minecraftRows(servers) };
}

async function reportPayload() {
  const [status, services, media, audit, systemUpdates, mediaSummary, plex] = await Promise.all([
    agent.status(), agent.services(), agent.media(), agent.audit(),
    agent.systemUpdates(true).catch((error) => ({ available: false, detail: error.message })),
    agent.mediaSummary().catch(() => null),
    agent.plex().catch(() => null),
  ]);
  return { embeds: reportEmbeds(status, services, media, audit, systemUpdates, mediaSummary, plex), components: panelRows() };
}

async function updatesPayload(force = false, allowActions = true) {
  const [snapshot, systemUpdates] = await Promise.all([
    agent.updates(force),
    agent.systemUpdates(force).catch((error) => ({ available: false, detail: error.message })),
  ]);
  return { embeds: [updatesEmbed(snapshot, systemUpdates)], components: updatesRows(snapshot, systemUpdates, allowActions) };
}

async function runSystemUpdateWorkflow(interaction, initialSnapshot = {}) {
  let snapshot = initialSnapshot;
  let tick = 0;
  let targetJobId = null;
  await interaction.update({ embeds: [systemUpdateLoadingEmbed(snapshot, tick)], components: [] });
  try {
    const accepted = await agent.applySystemUpdates(interaction.user);
    targetJobId = accepted.job_id;
    snapshot = { ...snapshot, ...accepted, phase: 'queued', job_id: targetJobId };
    await interaction.editReply({ embeds: [systemUpdateLoadingEmbed(snapshot, tick)], components: [] });
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await delay(2200);
      tick += 1;
      snapshot = await agent.systemUpdates(true);
      await interaction.editReply({ embeds: [systemUpdateLoadingEmbed(snapshot, tick)], components: [] });
      const sameJob = !targetJobId || snapshot.job_id === targetJobId;
      if (sameJob && ['complete', 'ready_for_reboot', 'failed'].includes(snapshot.phase)) break;
    }
    if (!['complete', 'ready_for_reboot', 'failed'].includes(snapshot.phase) || (targetJobId && snapshot.job_id !== targetJobId)) {
      snapshot = { ...snapshot, phase: 'failed', detail: 'Timed out waiting for the host maintenance bridge to finish' };
    }
    await interaction.editReply({
      embeds: [systemUpdateResultEmbed(snapshot)],
      components: updatesRows({ updates: [] }, snapshot, isAdmin(interaction)),
    });
  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed(error.message)], components: [] });
  }
}

async function runSystemRebootWorkflow(interaction, jobId) {
  await interaction.update({ embeds: [base('Ubuntu // restart requested', '🟡 Sending the confirmed restart request to the guarded host bridge…').setColor(colors.warn)], components: [] });
  try {
    await notifyMaintenanceEvent('Host restart starting', 'Ubuntu updates are applied. The host restart was explicitly confirmed; the controller will post again when the server is back online.', colors.warn);
    await agent.requestSystemReboot(jobId, interaction.user);
    await interaction.editReply({ embeds: [base('Ubuntu // restart queued', '🟡 The host is restarting now. The bot will announce its return in the weekly health channel when the server is back online.').setColor(colors.warn)], components: [] });
  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed(error.message)], components: [] });
  }
}

async function runBotReleaseWorkflow(interaction, action) {
  let release = { phase: 'queued' };
  let tick = 0;
  await interaction.update({ embeds: [botReleaseLoadingEmbed(action, release, tick)], components: [] });
  try {
    const accepted = action === 'rollback'
      ? await agent.rollbackBot(interaction.user)
      : await agent.updateBot(interaction.user);
    release = { ...release, ...accepted, phase: 'queued' };
    await interaction.editReply({ embeds: [botReleaseLoadingEmbed(action, release, tick)], components: [] });
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await delay(2200);
      tick += 1;
      const snapshot = await agent.updates(true);
      release = snapshot.bot || { ...release, phase: 'failed', detail: 'The agent did not return bot release status' };
      await interaction.editReply({ embeds: [botReleaseLoadingEmbed(action, release, tick)], components: [] });
      if (release.job_id && accepted.job_id && release.job_id !== accepted.job_id) {
        release = { ...release, phase: 'failed', detail: 'The host returned a different release job; no completion was claimed' };
        break;
      }
      if (['complete', 'rolled_back', 'failed'].includes(String(release.phase || '').toLowerCase())) break;
    }
    if (!['complete', 'rolled_back', 'failed'].includes(String(release.phase || '').toLowerCase())) {
      release = { ...release, phase: 'failed', detail: 'Timed out waiting for the guarded host release bridge' };
    }
    await interaction.editReply({ embeds: [botReleaseResultEmbed(action, release)], components: updateResultRows() });
  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed(error.message)], components: updateResultRows() });
  }
}

export async function handleCommand(interaction) {
  const publicOutputCommands = new Set(['panel', 'status', 'services', 'minecraft', 'media', 'storage', 'tasks', 'network', 'health', 'report', 'audit', 'updates']);
  const publicOutput = publicOutputCommands.has(interaction.commandName) && interaction.options.getBoolean('public') === true;
  await interaction.deferReply({ ephemeral: !publicOutput });
  let stopLoadingAnimation = null;
  let initialTaskSnapshot = null;
  if (interaction.commandName === 'health' || interaction.commandName === 'report' || interaction.commandName === 'panel' || interaction.commandName === 'updates' || interaction.commandName === 'tasks' || interaction.commandName === 'media' || interaction.commandName === 'network') {
    const title = interaction.commandName === 'report' ? 'Building detailed report…' : interaction.commandName === 'health' ? 'Running health diagnostic…' : interaction.commandName === 'updates' ? 'Checking application updates…' : interaction.commandName === 'tasks' ? 'Sampling Docker resources…' : interaction.commandName === 'media' ? 'Checking detected media…' : interaction.commandName === 'network' ? 'Checking detected network services…' : 'Loading control centre…';
    stopLoadingAnimation = await beginLoadingAnimation(interaction, title, interaction.commandName);
  }
  try {
    let payload;
    switch (interaction.commandName) {
      case 'panel': payload = await panelPayload(); break;
      case 'status': payload = await statusPayload(); break;
      case 'health': payload = await healthPayload(); break;
      case 'services': payload = await servicesPayload(); break;
      case 'network': payload = await networkPayload(); break;
      case 'controls': payload = await controlsPayload(); break;
      case 'minecraft': payload = await minecraftPayload(); break;
      case 'media': payload = await mediaPayload(); break;
      case 'storage': payload = { embeds: [storageEmbed(await agent.status())], components: panelRows() }; break;
      case 'tasks': {
        const taskResult = await tasksSnapshotPayload(true);
        initialTaskSnapshot = taskResult.snapshot;
        payload = taskResult.payload;
        break;
      }
      case 'report': payload = await reportPayload(); break;
      case 'updates': payload = await updatesPayload(true, isAdmin(interaction)); break;
      case 'wake': {
        const favorite = interaction.options.getString('favourite') || interaction.options.getString('favorite');
        const rawMac = interaction.options.getString('mac');
        const requestedLabel = interaction.options.getString('label');
        if (favorite && rawMac) throw new Error('Choose a favorite or provide a MAC address, not both');
        const saved = favorite ? getFavorite(favorite) : null;
        if (favorite && !saved) throw new Error(`Favourite **${favorite}** was not found`);
        const mac = rawMac || saved?.mac;
        if (!mac) throw new Error('Choose a favorite or provide a target MAC address');
        const broadcast = interaction.options.getString('broadcast') || saved?.broadcast || undefined;
        const label = requestedLabel || saved?.label || mac;
        await wakeDevice(mac, broadcast);
        let savedMessage = '';
        if (rawMac && requestedLabel && isAdmin(interaction)) {
          try {
            const savedLabel = saveFavorite(requestedLabel, rawMac, broadcast);
            savedMessage = `\n⭐ Saved as favourite **${savedLabel}**.`;
          } catch {
            savedMessage = '\n⚠️ Wake succeeded, but the favourite could not be saved.';
          }
        } else if (rawMac && requestedLabel) {
          savedMessage = '\n(Only admins can save new favourites.)';
        }
        payload = { embeds: [base('Wake signal sent', `⚡ Wake-on-LAN packet sent to **${label.replace(/[*_`]/g, '')}**.${savedMessage}`).setColor(colors.ok)] };
        break;
      }
      case 'audit': {
        const events = await agent.audit();
        const description = events.length ? events.slice(-15).reverse().map((event) => `• <t:${Math.floor(new Date(event.timestamp).getTime() / 1000)}:R> **${event.actor_name}** — ${event.action} ${event.service} (${event.result})`).join('\n') : 'No control actions have been recorded.';
        payload = { embeds: [base('Control audit', description)] };
        break;
      }
      default: throw new Error('Unknown command');
    }
    if (stopLoadingAnimation) await stopLoadingAnimation();
    const message = await interaction.editReply(payload);
    if (interaction.commandName === 'tasks') startTasksLive(interaction, message?.id || interaction.id, initialTaskSnapshot);
  } catch (error) {
    if (stopLoadingAnimation) await stopLoadingAnimation();
    await interaction.editReply({ embeds: [errorEmbed(error.message)], components: [] });
  }
}

export async function handleAutocomplete(interaction) {
  if (interaction.commandName !== 'wake' || !['favourite', 'favorite'].includes(interaction.options.getFocused(true).name)) {
    await interaction.respond([]);
    return;
  }
  const query = interaction.options.getFocused().toLowerCase();
  const choices = favoriteNames()
    .filter((name) => name.toLowerCase().includes(query))
    .slice(0, 25)
    .map((name) => ({ name, value: name }));
  await interaction.respond(choices);
}

export async function handleComponent(interaction) {
  try {
    if (interaction.customId.startsWith('nav:')) {
      const messageId = interaction.message?.id || interaction.id;
      stopTasksLive(messageId);
      const target = interaction.customId.split(':')[1];
      if (target === 'controls' && !isAdmin(interaction)) {
        throw new Error('Administrator access is required to view control policy');
      }
      await interaction.deferUpdate();
      let taskSnapshot = null;
      let payload;
      if (target === 'services') payload = await servicesPayload();
      else if (target === 'network') payload = await networkPayload();
      else if (target === 'controls') payload = await controlsPayload();
      else if (target === 'minecraft') payload = await minecraftPayload();
      else if (target === 'storage') payload = { embeds: [storageEmbed(await agent.status())], components: panelRows() };
      else if (target === 'media') payload = await mediaPayload();
      else if (target === 'tasks') {
        const taskResult = await tasksPayloadWithLoading(interaction, true);
        taskSnapshot = taskResult.snapshot;
        payload = taskResult.payload;
      } else if (target === 'updates') payload = await updatesPayload(true, isAdmin(interaction));
      else payload = await statusPayload();
      const message = await interaction.editReply(payload);
      if (target === 'tasks') startTasksLive(interaction, message?.id || messageId, taskSnapshot);
      return;
    }

    if (interaction.customId === 'updates:refresh') {
      await interaction.deferUpdate();
      await interaction.editReply(await updatesPayload(true, isAdmin(interaction)));
      return;
    }

    if (interaction.customId === 'updates:back') {
      await interaction.deferUpdate();
      await interaction.editReply(await updatesPayload(true, isAdmin(interaction)));
      return;
    }

    if (interaction.customId.startsWith('controls:page:')) {
      if (!isAdmin(interaction)) throw new Error('Administrator access is required to view control policy');
      const page = Math.max(0, Number(interaction.customId.split(':')[2] || 1) - 1);
      await interaction.deferUpdate();
      await interaction.editReply(await controlsPayload(page));
      return;
    }

    if (interaction.customId.startsWith('controls:refresh') || interaction.customId.startsWith('control:back')) {
      if (!isAdmin(interaction)) throw new Error('Administrator access is required to view control policy');
      const parts = interaction.customId.split(':');
      const page = Math.max(0, Number(parts[2] || 1) - 1);
      await interaction.deferUpdate();
      await interaction.editReply(await controlsPayload(page));
      return;
    }

    if (interaction.customId === 'updates:system-apply') {
      if (!isAdmin(interaction)) throw new Error('Admin access is required for Ubuntu updates');
      const systemUpdates = await agent.systemUpdates(true);
      if (!systemUpdates.maintenance_available) throw new Error('The guarded Ubuntu maintenance bridge is not installed');
      if (Number(systemUpdates.pending_count) <= 0) throw new Error('No pending Ubuntu updates were confirmed; refresh and try again');
      if (['checking', 'applying', 'rebooting', 'ready_for_reboot'].includes(systemUpdates.phase)) throw new Error('Ubuntu maintenance is already in progress or waiting for a restart confirmation');
      const id = stageConfirmation(interaction.user.id, { type: 'system-update', snapshot: systemUpdates });
      await interaction.reply({
        ephemeral: true,
        embeds: [base('Confirm Ubuntu updates', `Apply the **${systemUpdates.pending_count}** pending Ubuntu updates, including **${systemUpdates.security_count ?? 'unknown'}** security updates?\n\nThe bot will stream progress and will **not** restart automatically. A separate confirmation is required if Ubuntu requests one.`).setColor(colors.warn)],
        components: confirmRows(id),
      });
      return;
    }

    if (interaction.customId === 'updates:system-reboot') {
      if (!isAdmin(interaction)) throw new Error('Admin access is required to restart Ubuntu');
      const systemUpdates = await agent.systemUpdates(true);
      if (systemUpdates.phase !== 'ready_for_reboot' || !systemUpdates.reboot_required) throw new Error('Ubuntu is no longer waiting for a confirmed restart; refresh and try again');
      const id = stageConfirmation(interaction.user.id, { type: 'system-reboot', jobId: systemUpdates.job_id });
      await interaction.reply({
        ephemeral: true,
        embeds: [base('Confirm host restart', 'Ubuntu reports that the applied updates need a restart. Restart the host now?\n\nThe bot will announce the restart and then post again when the host is back online.').setColor(colors.warn)],
        components: confirmRows(id),
      });
      return;
    }

    if (interaction.customId === 'updates:bot-update') {
      if (!isAdmin(interaction)) throw new Error('Admin access is required for bot updates');
      const snapshot = await agent.updates(true);
      const release = snapshot.bot;
      if (!release?.configured) throw new Error(release?.detail || 'Configure a GitHub repository before updating the bot');
      if (!release.update_available) throw new Error('No newer stable bot release is available; refresh the update view');
      if (!release.asset_verified) throw new Error(release.detail || 'The release archive does not have a verified SHA-256 digest');
      if (!release.update_supported) throw new Error('The guarded host release bridge is not configured');
      const id = stageConfirmation(interaction.user.id, { type: 'bot-update', version: release.latest });
      await interaction.reply({
        ephemeral: true,
        embeds: [base('Confirm Homelab Control update', `Install the verified GitHub release **${release.latest}**?

Only the control agent and Discord bot images will be rebuilt. Other containers and their data are left untouched. The previous control images are retained so **Revert bot** remains available if verification fails.`).setColor(colors.warn)],
        components: confirmRows(id),
      });
      return;
    }

    if (interaction.customId === 'updates:bot-rollback') {
      if (!isAdmin(interaction)) throw new Error('Admin access is required for bot rollback');
      const snapshot = await agent.updates(true);
      const release = snapshot.bot;
      if (!release?.rollback_available) throw new Error('No previous bot release is available to revert to');
      if (!release.update_supported) throw new Error('The guarded host release bridge is not configured');
      const id = stageConfirmation(interaction.user.id, { type: 'bot-rollback', version: release.rollback_version });
      await interaction.reply({
        ephemeral: true,
        embeds: [base('Confirm Homelab Control rollback', `Restore the previous control release${release.rollback_version ? ` **${release.rollback_version}**` : ''}?

The host bridge will switch only the control agent and bot images, then verify both health checks.`).setColor(colors.warn)],
        components: confirmRows(id),
      });
      return;
    }

    if (interaction.customId === 'tasks:refresh') {
      const messageId = interaction.message?.id || interaction.id;
      const wasLive = tasksLiveSessions.has(messageId);
      stopTasksLive(messageId);
      await interaction.deferUpdate();
      const taskResult = await tasksPayloadWithLoading(interaction, true, wasLive, 0);
      await interaction.editReply(taskResult.payload);
      if (wasLive) startTasksLive(interaction, messageId, taskResult.snapshot);
      return;
    }

    if (interaction.customId === 'tasks:live') {
      const messageId = interaction.message?.id || interaction.id;
      stopTasksLive(messageId);
      await interaction.deferUpdate();
      const taskResult = await tasksPayloadWithLoading(interaction, true, true, 0);
      await interaction.editReply(taskResult.payload);
      startTasksLive(interaction, messageId, taskResult.snapshot);
      return;
    }

    if (interaction.customId === 'tasks:stop') {
      const messageId = interaction.message?.id || interaction.id;
      stopTasksLive(messageId);
      await interaction.deferUpdate();
      await interaction.editReply(await tasksPayload(false, false, 0, true));
      return;
    }

    if (interaction.customId.startsWith('tasks:select')) {
      stopTasksLive(interaction.message?.id || interaction.id);
      await interaction.deferUpdate();
      const snapshot = await withTasksLoading(interaction, () => agent.tasks());
      const task = (snapshot.containers || []).find((item) => item.id === interaction.values[0]);
      if (!task) throw new Error('That container is no longer running; refresh the task manager');
      await interaction.editReply({ embeds: [taskDetailEmbed(task)], components: tasksRows(snapshot, false) });
      return;
    }

    if (interaction.customId === 'updates:update-all') {
      if (!isAdmin(interaction)) throw new Error('Admin access is required for Runtipi updates');
      const id = stageConfirmation(interaction.user.id, { type: 'runtipi', scope: 'all' });
      await interaction.reply({
        ephemeral: true,
        embeds: [base('Confirm Runtipi update-all', 'Re-check available updates, request Runtipi’s normal app backups, and update eligible apps one at a time?\n\nThe controller stays protected. Each app must answer its Docker/app verification before it is marked successful.').setColor(colors.warn)],
        components: confirmRows(id),
      });
      return;
    }

    if (interaction.customId === 'updates:select') {
      if (!isAdmin(interaction)) throw new Error('Admin access is required for Runtipi updates');
      const appId = interaction.values[0];
      const snapshot = await agent.updates();
      const update = (snapshot.updates || []).find((item) => item.id === appId);
      if (!update) throw new Error('That update is no longer available; refresh the list and try again');
      const id = stageConfirmation(interaction.user.id, { type: 'runtipi', scope: 'one', appId: update.id, label: update.label, current: update.current, latest: update.latest });
      await interaction.reply({
        ephemeral: true,
        embeds: [base(`Confirm update • ${update.label}`, `Update **${update.current} → ${update.latest}** through Runtipi?\n\nRuntipi’s normal app backup will be requested, and the bot will wait for a successful Docker/app ping before reporting success.`).setColor(colors.warn)],
        components: confirmRows(id),
      });
      return;
    }

    if (interaction.customId.startsWith('service:select')) {
      await interaction.deferUpdate();
      const service = (await agent.services()).find((item) => item.key === interaction.values[0]);
      if (!service) throw new Error('Service no longer exists');
      await interaction.editReply({ embeds: [serviceDetail(service, isAdmin(interaction))], components: serviceActionRows(service, isAdmin(interaction)) }); return;
    }

    if (interaction.customId.startsWith('service-logs:')) {
      await interaction.deferReply({ ephemeral: true });
      const key = interaction.customId.split(':')[1];
      const logs = (await agent.logs(key)).join('\n').slice(-3800) || 'No recent logs.';
      await interaction.editReply({ embeds: [base(`Recent logs • ${key}`, `\`\`\`text\n${logs}\n\`\`\``)] }); return;
    }

    if (interaction.customId.startsWith('service-action:')) {
      if (!isAdmin(interaction)) throw new Error('Admin access is required for service changes');
      const [, key, action] = interaction.customId.split(':');
      const id = stageConfirmation(interaction.user.id, { type: 'service', key, action });
      await interaction.reply({ ephemeral: true, embeds: [base('Confirm service action', `Run **${action}** on **${key}**?\n\nThis action is logged and expires in 60 seconds.`).setColor(colors.warn)], components: confirmRows(id) }); return;
    }

    if (interaction.customId.startsWith('control:select')) {
      if (!isAdmin(interaction)) throw new Error('Administrator access is required to view control policy');
      await interaction.deferUpdate();
      const policy = await agent.controlPolicy();
      const service = (policy.services || []).find((item) => item.key === interaction.values[0]);
      if (!service) throw new Error('Container no longer exists; refresh the controls view');
      const page = Math.max(0, Number(interaction.customId.split(':')[2] || 1) - 1);
      await interaction.editReply({ embeds: [controlsEmbed([service], policy, { detail: true, selectedKey: service.key, page })], components: controlsRows([service], policy, { detail: true, selectedKey: service.key, page }) });
      return;
    }

    if (interaction.customId.startsWith('control-toggle:')) {
      if (!isAdmin(interaction)) throw new Error('Administrator access is required to change controls');
      const [, key, value] = interaction.customId.split(':');
      await interaction.deferUpdate();
      const policy = await agent.setControlPolicy(key, value === 'on', interaction.user);
      const services = await agent.services();
      await interaction.editReply({ embeds: [controlsEmbed(services, policy)], components: controlsRows(services, policy) });
      return;
    }

    if (interaction.customId.startsWith('mc:select')) {
      await interaction.deferUpdate();
      const server = (await crafty.servers()).find((item) => item.id === interaction.values[0]);
      if (!server) throw new Error('Minecraft server no longer exists');
      await interaction.editReply({ embeds: [loadingEmbed(`Minecraft // ${cleanMinecraftText(server.name, 100)}`, 0, 0, { steps: ['Reading panel/server status', 'Sampling CPU, RAM and process counters', 'Formatting the server detail'], phase: 'Reading server resources', detail: 'Read-only server sample · no Minecraft action is being made' })], components: [] });
      const detailed = await crafty.withStats(server);
      await interaction.editReply({ embeds: [mcDetail(detailed)], components: mcActionRows(detailed, isAdmin(interaction)) }); return;
    }

    if (interaction.customId.startsWith('mc-action:')) {
      if (!isAdmin(interaction)) throw new Error('Admin access is required for Minecraft changes');
      const [, serverId, action] = interaction.customId.split(':');
      const server = (await crafty.servers()).find((item) => item.id === serverId);
      if (!server) throw new Error('Minecraft server no longer exists');
      const id = stageConfirmation(interaction.user.id, { type: 'minecraft', serverId, serverName: cleanMinecraftText(server.name, 100), action });
      await interaction.reply({ ephemeral: true, embeds: [base('Confirm Minecraft action', `Run **${action}** on **${cleanMinecraftText(server.name, 100)}**?\n\nThis confirmation expires in 60 seconds.`).setColor(action === 'stop' || action === 'restart' ? colors.warn : colors.idle)], components: confirmRows(id) }); return;
    }

    if (interaction.customId.startsWith('mc-console:')) {
      if (!isAdmin(interaction)) throw new Error('Admin access is required for console commands');
      const serverId = interaction.customId.split(':')[1];
      const modal = new ModalBuilder().setCustomId(`mc-console-submit:${serverId}`).setTitle('Minecraft console');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('command').setLabel('Command (no leading slash)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)));
      await interaction.showModal(modal); return;
    }

    if (interaction.customId.startsWith('cancel:')) {
      confirmations.delete(interaction.customId.split(':')[1]);
      await interaction.update({ embeds: [base('Cancelled', 'No action was taken.')], components: [] }); return;
    }

    if (interaction.customId.startsWith('confirm:')) {
      if (!isAdmin(interaction)) throw new Error('Admin access is required to confirm changes');
      const id = interaction.customId.split(':')[1];
      const pending = confirmations.get(id);
      confirmations.delete(id);
      if (!pending || pending.expires < Date.now()) throw new Error('Confirmation expired; request the action again');
      if (pending.userId !== interaction.user.id) throw new Error('Only the person who requested this action can confirm it');
      if (pending.type === 'system-update') {
        await runSystemUpdateWorkflow(interaction, pending.snapshot);
        return;
      }
      if (pending.type === 'system-reboot') {
        await runSystemRebootWorkflow(interaction, pending.jobId);
        return;
      }
      if (pending.type === 'bot-update') {
        await runBotReleaseWorkflow(interaction, 'update');
        return;
      }
      if (pending.type === 'bot-rollback') {
        await runBotReleaseWorkflow(interaction, 'rollback');
        return;
      }
      if (pending.type === 'runtipi') {
        await interaction.update({ embeds: [updateLoadingEmbed(pending.scope === 'all' ? 'Updating Runtipi apps…' : `Updating ${pending.label}…`, 0, 0)], components: [] });
        let tick = 0;
        let running = true;
        const animation = (async () => {
          while (running) {
            // Keep edits comfortably below Discord's message rate limit while
            // still making long-running Runtipi updates feel alive.
            await delay(2200);
            if (!running) break;
            tick += 1;
            // The agent does not expose a per-app progress stream. Hold the
            // honest “waiting for Runtipi” phase instead of pretending that a
            // backup, Docker settle, or ping has completed on a timer.
            await interaction.editReply({ embeds: [updateLoadingEmbed(pending.scope === 'all' ? 'Updating Runtipi apps…' : `Updating ${pending.label}…`, 1, tick, 'Runtipi is completing the request; the bot will report success only after the Docker/app ping answers.')], components: [] });
          }
        })().catch(() => {});
        try {
          const result = pending.scope === 'all'
            ? await agent.updateAll(interaction.user)
            : await agent.update(pending.appId, interaction.user);
          running = false;
          await animation;
          await interaction.editReply({ embeds: [updateResultEmbed(result)], components: updateResultRows() });
        } catch (error) {
          running = false;
          await animation;
          await interaction.editReply({ embeds: [errorEmbed(error.message)], components: updateResultRows() });
        }
        return;
      }
      const actionTarget = pending.serverName || pending.key;
      await interaction.update({ embeds: [actionLoadingEmbed(actionTarget, pending.action, 0)], components: [] });
      let actionActive = true;
      let actionTick = 0;
      const actionAnimation = (async () => {
        while (actionActive) {
          await delay(1200);
          if (!actionActive) break;
          actionTick += 1;
          await interaction.editReply({ embeds: [actionLoadingEmbed(actionTarget, pending.action, actionTick)], components: [] });
        }
      })().catch(() => {});
      try {
        if (pending.type === 'service') await agent.action(pending.key, pending.action, interaction.user);
        else await crafty.action(pending.serverId, pending.action, interaction.user);
        actionActive = false;
        await actionAnimation;
        await interaction.editReply({ embeds: [base('Action completed', `✅ **${pending.action}** completed on **${actionTarget}**.`).setColor(colors.ok)], components: [] });
      } catch (error) {
        actionActive = false;
        await actionAnimation;
        await interaction.editReply({ embeds: [errorEmbed(error.message)], components: [] });
      }
      return;
    }
  } catch (error) {
    const payload = { embeds: [errorEmbed(error.message)], components: [] };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ephemeral: true, ...payload });
  }
}

const consoleDeny = /^(stop|restart|reload|op|deop|whitelist\s+off|ban-ip|pardon-ip)\b/i;

export async function handleModal(interaction) {
  if (!interaction.customId.startsWith('mc-console-submit:')) return;
  if (!isAdmin(interaction)) {
    await interaction.reply({ ephemeral: true, content: 'Admin access is required for console commands.' });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const serverId = interaction.customId.split(':')[1];
    const command = interaction.fields.getTextInputValue('command').trim().replace(/^\//, '');
    if (!command || consoleDeny.test(command)) throw new Error('That command is intentionally blocked here; use the dedicated controls or the Minecraft panel');
    await crafty.command(serverId, command);
    await interaction.editReply({ embeds: [base('Command sent', `✅ Sent to the Minecraft panel: \`${command.replace(/`/g, '')}\``).setColor(colors.ok)] });
  } catch (error) {
    await interaction.editReply({ embeds: [errorEmbed(error.message)] });
  }
}
