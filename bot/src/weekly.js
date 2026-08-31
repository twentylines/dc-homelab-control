import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { config } from './config.js';
import { agent } from './agent.js';
import { base, botName, colors, operatingSystemShortLabel, reportEmbeds, serverName } from './ui.js';

const STATE_FILE = '/data/weekly-report-state.json';
const CHECK_INTERVAL_MS = 30_000;
const SINGAPORE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timeZone,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

let timer = null;
let busy = false;

function readWebhookUrl() {
  try {
    const value = process.env.WEEKLY_REPORT_WEBHOOK_URL?.trim()
      || (existsSync(config.weeklyReportWebhookFile) ? readFileSync(config.weeklyReportWebhookFile, 'utf8').trim() : '');
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'discord.com' || !/^\/api\/webhooks\/\d+\/[^/]+$/.test(parsed.pathname) || parsed.search || parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function readState() {
  try {
    const value = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeState(state) {
  const temporary = `${STATE_FILE}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, STATE_FILE);
}

function sgtParts() {
  return Object.fromEntries(SINGAPORE_TIME.formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function weeklyKey(parts = sgtParts()) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isWeeklyWindow(parts = sgtParts()) {
  // The five-minute window prevents a restart or a small scheduling delay from
  // silently skipping the report, while the state key still guarantees one
  // report per Sunday.
  return parts.weekday === 'Sun' && parts.hour === '20' && Number(parts.minute) < 5;
}

async function postWebhook(payload) {
  const url = readWebhookUrl();
  if (!url) return false;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (![200, 204].includes(response.status)) throw new Error(`Discord webhook returned HTTP ${response.status}`);
  return true;
}

function safeError(error) {
  return error?.message ? String(error.message).replace(/[\r\n]/g, ' ').slice(0, 160) : 'not available';
}

export async function sendWeeklyReport() {
  const [status, services, media, audit, systemUpdates, mediaSummary, plex] = await Promise.all([
    agent.status(),
    agent.services(),
    agent.media(),
    agent.audit(),
    agent.systemUpdates(true).catch((error) => ({ available: false, detail: safeError(error) })),
    agent.mediaSummary().catch(() => null),
    agent.plex().catch(() => null),
  ]);
  const embeds = reportEmbeds(status, services, media, audit, systemUpdates, mediaSummary, plex).map((embed) => embed.toJSON());
  return postWebhook({ username: botName(), embeds });
}

export async function notifyMaintenanceEvent(title, description, colour = colors.warn) {
  try {
    return await postWebhook({
      username: botName(),
      embeds: [base(title, description).setColor(colour).toJSON()],
    });
  } catch (error) {
    console.warn('Maintenance webhook notification failed:', safeError(error));
    return false;
  }
}

export async function notifyMaintenanceOnline() {
  try {
    const snapshot = await agent.systemUpdates(true);
    if (snapshot.phase !== 'online') return false;
    const key = `${snapshot.job_id || 'unknown'}:${snapshot.boot_id || 'unknown'}`;
    const state = readState();
    if (state.lastOnline === key) return false;
    const sent = await postWebhook({
      username: botName(),
      embeds: [base(`${serverName()} is back online`, `🟢 ${operatingSystemShortLabel(snapshot, 'The host')} completed the confirmed restart and is responding again.\n\nJob **${snapshot.job_id || 'unknown'}** · <t:${Math.floor(new Date(snapshot.online_at || Date.now()).getTime() / 1000)}:R>`).setColor(colors.ok).toJSON()],
    });
    if (sent) {
      state.lastOnline = key;
      writeState(state);
    }
    return sent;
  } catch (error) {
    console.warn('Maintenance online check failed:', safeError(error));
    return false;
  }
}

async function maybeSendWeeklyReport() {
  if (!config.weeklyReportEnabled || busy || !readWebhookUrl()) return false;
  const parts = sgtParts();
  if (!isWeeklyWindow(parts)) return false;
  const state = readState();
  const key = weeklyKey(parts);
  if (state.lastWeeklyReport === key) return false;
  busy = true;
  try {
    const sent = await sendWeeklyReport();
    if (sent) {
      state.lastWeeklyReport = key;
      writeState(state);
    }
    return sent;
  } catch (error) {
    console.warn('Weekly health report failed:', safeError(error));
    return false;
  } finally {
    busy = false;
  }
}

export function startWeeklyReporter() {
  if (!config.weeklyReportEnabled || !readWebhookUrl()) return null;
  if (timer) return timer;
  timer = setInterval(() => {
    maybeSendWeeklyReport().catch(() => {});
    notifyMaintenanceOnline().catch(() => {});
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export const weeklyInternals = { isWeeklyWindow, sgtParts, weeklyKey, readWebhookUrl, maybeSendWeeklyReport };
