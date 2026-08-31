import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { agent } from './agent.js';
import { readSettings } from './settings.js';
import { botMaintenanceRestartEmbed, botMaintenanceResultEmbed, settingsRows } from './ui.js';
import { notifyMaintenanceEvent } from './weekly.js';

// Recovery actions can recreate the bot just like a release update. Keep a
// short-lived Discord webhook handle on the private data volume so a restart
// edits the original interaction instead of leaving the administrator with a
// silent or failed request.
const STATE_FILE = '/data/bot-maintenance-interaction.json';
const MAX_INTERACTION_AGE_MS = 14 * 60 * 1000;
const POLL_INTERVAL_MS = 4_000;
const ACTIONS = new Set(['restart', 'reset', 'restore', 'fix-preserve', 'fix-fresh']);
const TERMINAL_PHASES = new Set(['complete', 'failed']);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseState(path = STATE_FILE) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object') return null;
    if (!/^\d{16,24}$/.test(String(value.application_id || ''))) return null;
    if (typeof value.interaction_token !== 'string' || value.interaction_token.length < 40) return null;
    if (!ACTIONS.has(value.action)) return null;
    if (value.job_id && !/^[A-Za-z0-9_-]{1,80}$/.test(String(value.job_id))) return null;
    if (Number(value.expires_at || 0) <= 0) return null;
    return value;
  } catch {
    return null;
  }
}

function writeState(state) {
  const temporary = `${STATE_FILE}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, STATE_FILE);
}

function clearFile() {
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch {
    // A later startup can safely retry cleanup after a transient filesystem error.
  }
}

export function clearBotMaintenanceResume() {
  clearFile();
}

export function stageBotMaintenanceResume(interaction, action, accepted) {
  if (!ACTIONS.has(action)) throw new Error('Unsupported maintenance resume action');
  const createdAt = Date.now();
  writeState({
    schema: 1,
    application_id: String(interaction.applicationId),
    interaction_token: String(interaction.token),
    action,
    job_id: String(accepted?.job_id || ''),
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

export async function resumeBotMaintenanceWorkflow() {
  const state = parseState();
  if (!state) {
    clearFile();
    return false;
  }

  let status = { phase: 'restarting', job_id: state.job_id };
  await editOriginal(state, botMaintenanceRestartEmbed(state.action, status)).catch(() => false);

  while (Date.now() < Number(state.expires_at || 0)) {
    try {
      const snapshot = await agent.updates(true, readSettings().releaseChannel);
      const next = snapshot?.bot;
      if (next) status = next;
      if (!sameJob(state, status)) {
        status = { ...status, phase: 'failed', detail: 'A different maintenance job was returned after restart; completion was not claimed.' };
        break;
      }
      if (TERMINAL_PHASES.has(String(status.phase || '').toLowerCase())) break;
    } catch {
      // Agent and bot containers can be unavailable while the bridge recreates
      // them. Keep polling without claiming that the action failed.
    }
    await delay(POLL_INTERVAL_MS);
  }

  const phase = String(status.phase || '').toLowerCase();
  if (!TERMINAL_PHASES.has(phase)) {
    status = { ...status, phase: 'failed', detail: 'The Discord interaction expired before maintenance verification completed. Open /settings for the current state.' };
  }
  const edited = await editOriginal(state, botMaintenanceResultEmbed(state.action, status), settingsRows(readSettings(), 'recovery')).catch(() => false);
  const complete = String(status.phase || '').toLowerCase() === 'complete';
  const fallbackSent = edited ? false : await notifyMaintenanceEvent(
    complete ? 'Homelab Control maintenance complete' : 'Homelab Control maintenance needs attention',
    complete
      ? `🟢 The **${state.action}** action completed and the control state was verified.`
      : `🔴 The **${state.action}** action ended in **${String(status.phase || 'unknown').replace(/_/g, ' ')}**. Open `/settings` for the latest state.`,
    complete ? 0x57f287 : 0xed4245,
  ).catch(() => false);
  if (edited || fallbackSent || Date.now() >= Number(state.expires_at || 0)) clearFile();
  return edited || fallbackSent;
}

export const maintenanceResumeInternals = { parseState, sameJob };
