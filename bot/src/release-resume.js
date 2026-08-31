import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { agent } from './agent.js';
import { botReleaseRestartEmbed, botReleaseResultEmbed, updateResultRows } from './ui.js';
import { notifyMaintenanceEvent } from './weekly.js';

const STATE_FILE = '/data/bot-release-interaction.json';
const MAX_INTERACTION_AGE_MS = 14 * 60 * 1000;
const POLL_INTERVAL_MS = 4_000;
const TERMINAL_PHASES = new Set(['complete', 'rolled_back', 'failed']);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readState() {
  try {
    const value = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (!value || typeof value !== 'object') return null;
    if (!/^\d{16,24}$/.test(String(value.application_id || ''))) return null;
    if (typeof value.interaction_token !== 'string' || value.interaction_token.length < 40) return null;
    if (!['update', 'rollback'].includes(value.action)) return null;
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

export function clearBotReleaseResume() {
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch {
    // A later startup can safely retry the same job if cleanup is unavailable.
  }
}

export function stageBotReleaseResume(interaction, action, accepted) {
  const createdAt = Date.now();
  writeState({
    schema: 1,
    application_id: String(interaction.applicationId),
    interaction_token: String(interaction.token),
    action,
    job_id: String(accepted?.job_id || ''),
    target: accepted?.latest || accepted?.requested_version || accepted?.rollback_version || null,
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

function sameJob(state, release) {
  return !state.job_id || !release?.job_id || state.job_id === release.job_id;
}

export async function resumeBotReleaseWorkflow() {
  const state = readState();
  if (!state) return false;

  let release = { phase: 'restarting', requested_version: state.target, job_id: state.job_id };
  await editOriginal(state, botReleaseRestartEmbed(state.action, release)).catch(() => false);

  while (Date.now() < Number(state.expires_at || 0)) {
    try {
      const snapshot = await agent.updates(true);
      release = snapshot.bot || release;
      const phase = String(release.phase || '').toLowerCase();
      if (!sameJob(state, release)) {
        release = { ...release, phase: 'failed', detail: 'A different release job was returned after restart; completion was not claimed.' };
        break;
      }
      if (TERMINAL_PHASES.has(phase)) break;
    } catch {
      // Both containers restart during this workflow. Silence temporary network
      // failures and keep waiting for the replacement agent to become healthy.
    }
    await delay(POLL_INTERVAL_MS);
  }

  const phase = String(release.phase || '').toLowerCase();
  if (!TERMINAL_PHASES.has(phase)) {
    release = { ...release, phase: 'failed', detail: 'The Discord interaction expired before runtime verification completed. Open /updates for the current release state.' };
  }
  const edited = await editOriginal(state, botReleaseResultEmbed(state.action, release), updateResultRows()).catch(() => false);
  const complete = ['complete', 'rolled_back'].includes(String(release.phase || '').toLowerCase());
  const fallbackSent = edited ? false : await notifyMaintenanceEvent(
    complete ? 'Homelab Control update complete' : 'Homelab Control update needs attention',
    complete
      ? `🟢 Version **${release.current || release.requested_version || 'unknown'}** is running and both control health checks passed after restart.`
      : `🔴 The guarded release job ended in **${String(release.phase || 'unknown').replace(/_/g, ' ')}**. Open \`/updates\` for the latest verified state.`,
    complete ? 0x57f287 : 0xed4245,
  ).catch(() => false);
  if (edited || fallbackSent || Date.now() >= Number(state.expires_at || 0)) clearBotReleaseResume();
  return edited || fallbackSent;
}

export const releaseResumeInternals = { readState, sameJob };
