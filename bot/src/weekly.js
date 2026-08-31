import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { config } from './config.js';
import { agent } from './agent.js';
import { markPostUpdateNotice, readSettings } from './settings.js';
import { base, botName, colors, operatingSystemShortLabel, serverName, weeklyHealthEmbed } from './ui.js';

const STATE_FILE = '/data/weekly-report-state.json';
const HOST_REBOOT_STATE_FILE = '/data/host-reboot-interaction.json';
const HOST_REBOOT_LAST_ONLINE_FILE = '/data/host-reboot-last-online.json';
const CHECK_INTERVAL_MS = 30_000;
const LOCAL_TIME = new Intl.DateTimeFormat('en-GB', {
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
let autoBusy = false;

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

function hostRebootResumePending() {
  try {
    const state = JSON.parse(readFileSync(HOST_REBOOT_STATE_FILE, 'utf8'));
    if (Number(state?.expires_at || 0) > Date.now()) return true;
    unlinkSync(HOST_REBOOT_STATE_FILE);
  } catch {
    // No pending host-reboot hand-off is the normal state.
  }
  return false;
}

function hostRebootAlreadyAnnounced(snapshot) {
  try {
    const state = JSON.parse(readFileSync(HOST_REBOOT_LAST_ONLINE_FILE, 'utf8'));
    return state?.key === `${snapshot?.job_id || 'unknown'}:${snapshot?.boot_id || 'unknown'}`;
  } catch {
    return false;
  }
}

function sgtParts() {
  return Object.fromEntries(LOCAL_TIME.formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
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

function releaseParts(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:(?:([a-z]))|-(\d[0-9A-Za-z.-]*|[A-Za-z][0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z.-]+)?$/i);
  if (!match) return null;
  const parts = { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), suffix: (match[4] || '').toLowerCase() };
  if (match[5]) parts.prerelease = match[5].toLowerCase();
  return parts;
}

function isHotfixVersion(value) {
  return Boolean(releaseParts(value)?.suffix);
}

function hasMajorStableAdvance(current, latest) {
  const currentParts = releaseParts(current);
  const latestParts = releaseParts(latest);
  if (!currentParts || !latestParts || latestParts.suffix || latestParts.prerelease) return false;
  return latestParts.major > currentParts.major
    || (latestParts.major === currentParts.major && latestParts.minor > currentParts.minor);
}

function hasStableAdvance(current, latest) {
  const currentParts = releaseParts(current);
  const latestParts = releaseParts(latest);
  if (!currentParts || !latestParts || latestParts.suffix || latestParts.prerelease) return false;
  return compareReleaseVersions(latest, current) > 0;
}

function hotfixAutoReleaseAllowed(current, latest) {
  const currentParts = releaseParts(current);
  const latestParts = releaseParts(latest);
  return Boolean(currentParts && latestParts)
    && isHotfixVersion(latest)
    && !currentParts.prerelease
    && !latestParts.prerelease
    && latestParts.major === currentParts.major
    && latestParts.minor === currentParts.minor
    && latestParts.patch === currentParts.patch
    && compareReleaseVersions(latest, current) > 0;
}

function comparePrerelease(left, right) {
  const leftTokens = String(left || '').split('.');
  const rightTokens = String(right || '').split('.');
  const length = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= leftTokens.length) return -1;
    if (index >= rightTokens.length) return 1;
    const a = leftTokens[index];
    const b = rightTokens[index];
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) > Number(b) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

function compareReleaseVersions(left, right) {
  const a = releaseParts(left);
  const b = releaseParts(right);
  if (!a || !b) return 0;
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  // Stable patch < compact letter hotfix, while SemVer pre-releases remain
  // below the matching stable patch and compare by identifier semantics.
  const phase = (parts) => (parts.suffix ? 2 : parts.prerelease ? 0 : 1);
  const leftPhase = phase(a);
  const rightPhase = phase(b);
  if (leftPhase !== rightPhase) return leftPhase > rightPhase ? 1 : -1;
  if (a.suffix || b.suffix) return a.suffix === b.suffix ? 0 : a.suffix > b.suffix ? 1 : -1;
  if (a.prerelease || b.prerelease) return comparePrerelease(a.prerelease, b.prerelease);
  return 0;
}

function autoReleaseAllowed(release, mode, scheduleParts = null) {
  if (!release || !release.update_available || !release.asset_verified || !release.update_supported) return false;
  const latest = release.latest;
  const current = release.current;
  if (!releaseParts(latest) || !releaseParts(current)) return false;
  if (mode === 'hotfix') {
    return hotfixAutoReleaseAllowed(current, latest);
  }
  if (mode === 'weekly') {
    // Weekly mode still picks up compact hotfixes during the daily window;
    // ordinary stable releases wait for the weekly window.
    return hotfixAutoReleaseAllowed(current, latest)
      || (scheduleParts?.weekday === 'Sun' && hasStableAdvance(current, latest));
  }
  return mode === 'daily';
}


function isAutoWindow(parts, mode, hour = config.autoUpdateHour) {
  if (!['daily', 'weekly', 'hotfix'].includes(mode)) return false;
  if (String(parts.hour).padStart(2, '0') !== String(hour).padStart(2, '0')) return false;
  if (Number(parts.minute) >= 10) return false;
  // Weekly mode runs in the same daily window so compact hotfixes can be
  // installed every day. The release policy below admits ordinary stable
  // releases only on Sunday.
  return true;
}

function betaAutoUpdateAllowed(settings = {}) {
  // Stable releases remain conservative by default. Selecting the beta
  // channel is not enough to authorize unattended live-patch updates: an
  // administrator must acknowledge the route in /settings first.
  return settings.releaseChannel !== 'beta' || settings.betaAutoUpdateConfirmed === true;
}

function autoAttemptKey(parts, settings, release) {
  return `${weeklyKey(parts)}:${settings.autoUpdateMode}:${settings.releaseChannel}:${release.latest}`;
}

async function maybeRecordAutoUpdateCompletion() {
  const state = readState();
  const pending = state.pendingAutoUpdate;
  if (!pending || !pending.key) return false;
  try {
    const settings = readSettings();
    const snapshot = await agent.updates(true, settings.releaseChannel);
    const release = snapshot?.bot || {};
    const phase = String(release.phase || '').toLowerCase();
    if (release.automatic !== true || !['complete', 'failed'].includes(phase)) return false;
    if (pending.job_id && release.job_id && pending.job_id !== release.job_id) return false;
    state.pendingAutoUpdate = null;
    if (phase === 'complete') {
      markPostUpdateNotice(release.current || pending.requested_version, release.previous || pending.previous);
      state.lastAutoCompletion = pending.key;
    } else {
      state.lastAutoFailure = pending.key;
    }
    writeState(state);
    return true;
  } catch (error) {
    console.warn('Automatic update completion check failed:', safeError(error));
    return false;
  }
}

export async function maybeAutoUpdate(parts = sgtParts()) {
  if (autoBusy) return false;
  const settings = readSettings();
  const mode = settings.autoUpdateMode;
  if (!betaAutoUpdateAllowed(settings)) return false;
  if (!isAutoWindow(parts, mode, settings.autoUpdateHour)) return false;
  const state = readState();
  if (state.pendingAutoUpdate) return false;
  autoBusy = true;
  try {
    const snapshot = await agent.updates(true, settings.releaseChannel);
    const release = snapshot?.bot || {};
    if (!autoReleaseAllowed(release, mode, parts)) return false;
    const key = autoAttemptKey(parts, settings, release);
    if (state.lastAutoAttempt === key || state.lastAutoCompletion === key) return false;
    if (['queued', 'checking', 'downloading', 'verifying', 'staging', 'building', 'restarting', 'verifying_runtime'].includes(String(release.phase || '').toLowerCase())) return false;
    const accepted = await agent.updateBot({ id: 'automatic', username: 'scheduled update' }, true, settings.releaseChannel, settings.betaAutoUpdateConfirmed === true);
    state.lastAutoAttempt = key;
    state.pendingAutoUpdate = {
      key,
      job_id: String(accepted?.job_id || '').slice(0, 80),
      requested_version: String(release.latest || '').slice(0, 40),
      previous: String(release.current || '').slice(0, 40),
    };
    writeState(state);
    return true;
  } catch (error) {
    console.warn('Automatic bot update check failed:', safeError(error));
    return false;
  } finally {
    autoBusy = false;
  }
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
  if (!error?.message) return 'not available';
  return String(error.message)
    .replace(/https:\/\/discord\.com\/api\/webhooks\/\d+\/[^\s/]+/gi, '[redacted webhook]')
    .replace(/\b(token|password|secret|api[_-]?key)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 160);
}

export async function sendWeeklyReport() {
  const [status, services, media, mediaSummary, systemUpdates, updates] = await Promise.all([
    agent.status(),
    agent.services(),
    agent.media(),
    agent.mediaSummary().catch(() => null),
    agent.systemUpdates(true).catch((error) => ({ available: false, detail: safeError(error) })),
    agent.updates(true, readSettings().releaseChannel).catch((error) => ({ available: false, detail: safeError(error) })),
  ]);
  const embed = weeklyHealthEmbed(status, services, media, systemUpdates, updates, mediaSummary);
  return postWebhook({ username: botName(), embeds: [embed.toJSON()] });
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
    // The durable host-resume worker owns the original Discord interaction
    // while a confirmed reboot is in flight. Avoid a competing generic
    // webhook that would race it or produce a duplicate completion notice.
    if (hostRebootResumePending()) return false;
    const snapshot = await agent.systemUpdates(true);
    if (snapshot.phase !== 'online') return false;
    if (hostRebootAlreadyAnnounced(snapshot)) return false;
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
  if (timer) return timer;
  timer = setInterval(() => {
    maybeRecordAutoUpdateCompletion().catch(() => {});
    maybeAutoUpdate().catch(() => {});
    maybeSendWeeklyReport().catch(() => {});
    notifyMaintenanceOnline().catch(() => {});
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export const weeklyInternals = {
  isWeeklyWindow,
  sgtParts,
  weeklyKey,
  readWebhookUrl,
  maybeSendWeeklyReport,
  maybeAutoUpdate,
  maybeRecordAutoUpdateCompletion,
  releaseParts,
  compareReleaseVersions,
  isHotfixVersion,
  hasMajorStableAdvance,
  autoReleaseAllowed,
  isAutoWindow,
  betaAutoUpdateAllowed,
  hasStableAdvance,
  hotfixAutoReleaseAllowed,
};
