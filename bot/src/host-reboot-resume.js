import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { agent } from './agent.js';
import { readSettings } from './settings.js';
import { hostRestartResultEmbed, hostRestartWaitingEmbed, updateResultRows } from './ui.js';
import { notifyMaintenanceEvent } from './weekly.js';

// A host reboot tears down the process that owns the Discord interaction. Keep
// only the short-lived webhook handle and job identity needed to finish that
// one interaction after the replacement bot is healthy. The file is mounted
// on the private bot data volume and is written with owner-only permissions.
const STATE_FILE = '/data/host-reboot-interaction.json';
const LAST_ONLINE_FILE = '/data/host-reboot-last-online.json';
const MAX_INTERACTION_AGE_MS = 14 * 60 * 1000;
const POLL_INTERVAL_MS = 4_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseState(path = STATE_FILE) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object') return null;
    if (!/^\d{16,24}$/.test(String(value.application_id || ''))) return null;
    if (typeof value.interaction_token !== 'string' || value.interaction_token.length < 40) return null;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(value.job_id || ''))) return null;
    if (Number(value.expires_at || 0) <= 0) return null;
    return value;
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, path);
}

function clearFile(path = STATE_FILE) {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // A later startup can safely retry cleanup after a transient filesystem error.
  }
}

export function clearHostRebootResume() {
  clearFile(STATE_FILE);
}

export function stageHostRebootResume(interaction, jobId, osName = 'Host') {
  const createdAt = Date.now();
  writeJson(STATE_FILE, {
    schema: 1,
    application_id: String(interaction.applicationId),
    interaction_token: String(interaction.token),
    job_id: String(jobId || ''),
    os_name: String(osName || 'Host').slice(0, 120),
    created_at: createdAt,
    expires_at: createdAt + MAX_INTERACTION_AGE_MS,
  });
}

async function editOriginal(state, embed, components = []) {
  if (Date.now() >= Number(state.expires_at || 0)) return false;
  const response = await fetch(`https://discord.com/api/v10/webhooks/${state.application_id}/${state.interaction_token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [embed.toJSON()],
      components: components.map((row) => row.toJSON()),
      allowed_mentions: { parse: [] },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}

function sameJob(state, snapshot) {
  return !state.job_id || !snapshot?.job_id || String(state.job_id) === String(snapshot.job_id);
}

function onlineKey(snapshot) {
  return `${snapshot?.job_id || 'unknown'}:${snapshot?.boot_id || 'unknown'}`;
}

function markOnline(snapshot) {
  try {
    writeJson(LAST_ONLINE_FILE, { key: onlineKey(snapshot), at: new Date().toISOString() });
  } catch {
    // The completion message is still useful if the marker cannot be written.
  }
}

export function hasPendingHostRebootResume() {
  const state = parseState();
  if (!state) {
    // Remove malformed or expired handles so they cannot suppress the normal
    // maintenance notification forever.
    clearFile(STATE_FILE);
    return false;
  }
  return Date.now() < Number(state.expires_at);
}

export function hostRebootOnlineKey() {
  try {
    const value = JSON.parse(readFileSync(LAST_ONLINE_FILE, 'utf8'));
    return typeof value?.key === 'string' ? value.key : null;
  } catch {
    return null;
  }
}

export async function resumeHostRebootWorkflow() {
  const state = parseState();
  if (!state) {
    clearFile(STATE_FILE);
    return false;
  }

  let snapshot = { phase: 'rebooting', job_id: state.job_id, os: { name: state.os_name, pretty_name: state.os_name } };
  await editOriginal(state, hostRestartWaitingEmbed(snapshot)).catch(() => false);

  while (Date.now() < Number(state.expires_at || 0)) {
    try {
      snapshot = await agent.systemUpdates(true);
      if (!sameJob(state, snapshot)) {
        snapshot = { ...snapshot, phase: 'failed', detail: 'A different host maintenance job was returned after restart; completion was not claimed.' };
        break;
      }
      const phase = String(snapshot.phase || '').toLowerCase();
      if (phase === 'online' || phase === 'failed') break;
    } catch {
      // The host bridge and Discord bot may come up at different times. A
      // temporary agent failure is expected during that hand-off.
    }
    await delay(POLL_INTERVAL_MS);
  }

  const phase = String(snapshot.phase || '').toLowerCase();
  if (!['online', 'failed'].includes(phase)) {
    snapshot = { ...snapshot, phase: 'failed', detail: 'The Discord interaction expired before the host returned an online status. Open /updates for the latest state.' };
  }
  const complete = snapshot.phase === 'online';
  const edited = await editOriginal(state, hostRestartResultEmbed(snapshot), updateResultRows()).catch(() => false);
  const fallbackSent = edited ? false : await notifyMaintenanceEvent(
    complete ? 'Host restart complete' : 'Host restart needs attention',
    complete
      ? `🟢 ${state.os_name} is back online after the confirmed restart. The host bridge reported the new boot successfully.`
      : `🔴 The confirmed host restart ended in **${String(snapshot.phase || 'unknown').replace(/_/g, ' ')}**. Open \`/updates\` for the latest verified state.`,
    complete ? 0x57f287 : 0xed4245,
  ).catch(() => false);
  if (complete && (edited || fallbackSent)) markOnline(snapshot);
  if (edited || fallbackSent || Date.now() >= Number(state.expires_at || 0)) clearFile(STATE_FILE);
  return edited || fallbackSent;
}

export const hostRebootResumeInternals = { parseState, sameJob, onlineKey };
