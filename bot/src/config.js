import { existsSync, readFileSync } from 'node:fs';

function loadOptionalConfigFile() {
  const path = process.env.HOMELAB_CONTROL_CONFIG_FILE?.trim() || '/data/config.env';
  let lines;
  try {
    lines = readFileSync(path, 'utf8').split(/\r?\n/);
  } catch {
    return;
  }
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    // A non-empty Compose/Runtipi value always wins. Empty form fields are
    // common in Runtipi, though, and must still allow the optional config file
    // to provide the advanced settings without duplicating the whole form.
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
  }
}

loadOptionalConfigFile();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required setting: ${name}`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || '';
}

function list(name) {
  return [...new Set((process.env[name] || '').split(',').map((value) => value.trim()).filter(Boolean))];
}

const controlTokenFile = optional('CONTROL_TOKEN_FILE') || '/run/secrets/control-token';
const controlToken = existsSync(controlTokenFile)
  ? readFileSync(controlTokenFile, 'utf8').trim()
  : optional('CONTROL_TOKEN');
if (controlToken.length < 32) throw new Error('The internal controller token is invalid');

const primaryGuildId = required('DISCORD_GUILD_ID');
const guildIds = [...new Set([primaryGuildId, ...list('DISCORD_GUILD_IDS')])];
const adminRoleIds = [...new Set([optional('DISCORD_ADMIN_ROLE_ID'), ...list('DISCORD_ADMIN_ROLE_IDS')].filter(Boolean))];

function bounded(value, fallback, maximum = 80) {
  const cleaned = String(value || '').replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maximum) : fallback;
}

const controlMode = optional('SERVICE_CONTROL_MODE').toLowerCase();
if (controlMode && !['opt-in', 'opt-out'].includes(controlMode)) {
  throw new Error('SERVICE_CONTROL_MODE must be opt-in or opt-out');
}

const releaseChannel = bounded(optional('HOMELAB_CONTROL_RELEASE_CHANNEL'), 'stable', 16).toLowerCase();
if (!['stable'].includes(releaseChannel)) {
  throw new Error('HOMELAB_CONTROL_RELEASE_CHANNEL must be stable');
}

const minecraftBackend = bounded(optional('MINECRAFT_BACKEND'), 'auto', 24).toLowerCase();
if (!['auto', 'docker', 'crafty', 'pterodactyl', 'pelican', 'none'].includes(minecraftBackend)) {
  throw new Error('MINECRAFT_BACKEND must be auto, docker, crafty, pterodactyl, pelican or none');
}

export const config = Object.freeze({
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: primaryGuildId,
  guildIds,
  ownerId: required('DISCORD_OWNER_ID'),
  adminRoleId: adminRoleIds[0] || '',
  adminUserIds: list('DISCORD_ADMIN_USER_IDS'),
  adminRoleIds,
  guestUserIds: list('DISCORD_GUEST_USER_IDS'),
  guestRoleIds: list('DISCORD_GUEST_ROLE_IDS'),
  botName: bounded(optional('BOT_NAME'), 'Homelab Control'),
  serverName: bounded(optional('SERVER_NAME'), ''),
  timeZone: bounded(optional('TIME_ZONE'), 'UTC', 64),
  serviceControlMode: controlMode || 'opt-out',
  configFile: process.env.HOMELAB_CONTROL_CONFIG_FILE?.trim() || '/data/config.env',
  mediaRequiredProviders: list('MEDIA_REQUIRED_PROVIDERS'),
  mediaStackProfile: bounded(optional('MEDIA_STACK_PROFILE'), 'auto', 32).toLowerCase(),
  networkRequiredProviders: list('NETWORK_REQUIRED_PROVIDERS'),
  agentUrl: optional('HOMELAB_CONTROL_AGENT_URL') || 'http://agent:8787',
  repository: bounded(optional('HOMELAB_CONTROL_REPOSITORY'), '', 180),
  releaseChannel,
  controlToken,
  craftyUrl: optional('CRAFTY_BASE_URL'),
  craftyToken: optional('CRAFTY_API_TOKEN'),
  craftyAllowInsecureTls: optional('CRAFTY_ALLOW_INSECURE_TLS').toLowerCase() === 'true',
  minecraftBackend,
  pterodactylUrl: optional('PTERODACTYL_BASE_URL'),
  pterodactylToken: optional('PTERODACTYL_API_TOKEN'),
  pelicanUrl: optional('PELICAN_BASE_URL'),
  pelicanToken: optional('PELICAN_API_TOKEN'),
  wakeDefaultLabel: bounded(optional('WAKE_DEFAULT_LABEL'), '', 48),
  wakeDefaultMac: optional('WAKE_DEFAULT_MAC'),
  wakeDefaultIp: optional('WAKE_DEFAULT_IP'),
  wakeBroadcast: optional('WAKE_BROADCAST') || '255.255.255.255',
  weeklyReportWebhookFile: optional('WEEKLY_REPORT_WEBHOOK_FILE') || '/run/secrets/weekly-report/webhook.url',
  weeklyReportEnabled: optional('WEEKLY_REPORT_ENABLED').toLowerCase() !== 'false',
  healthPort: Number(optional('HEALTH_PORT') || 3000),
});
