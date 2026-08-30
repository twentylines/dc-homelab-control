import { config } from './config.js';

async function request(path, options = {}) {
  const { timeoutMs = 15_000, ...fetchOptions } = options;
  const response = await fetch(`${config.agentUrl}${path}`, {
    ...fetchOptions,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'X-Homelab-Control-Token': config.controlToken,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error || `Agent HTTP ${response.status}`);
  return body.data ?? body;
}

export const agent = {
  status: () => request('/v1/status'),
  services: () => request('/v1/services'),
  controlPolicy: () => request('/v1/control-policy'),
  setControlPolicy: (key, enabled, user) => request('/v1/control-policy', {
    method: 'POST',
    body: JSON.stringify({ key, enabled }),
    headers: {
      'Content-Type': 'application/json',
      'X-Discord-User-ID': user.id,
      'X-Discord-User-Name': user.username,
    },
  }),
  media: () => request('/v1/media'),
  mediaSummary: () => request('/v1/media-summary'),
  network: () => request('/v1/network'),
  networkSummary: () => request('/v1/network-summary'),
  minecraft: () => request('/v1/minecraft'),
  sessions: () => request('/v1/sessions'),
  jellyfin: () => request('/v1/jellyfin'),
  plex: () => request('/v1/plex'),
  mediaResources: (refresh = false) => request(`/v1/media-resources${refresh ? '?refresh=1' : ''}`),
  tasks: (refresh = false) => request(`/v1/tasks${refresh ? '?refresh=1' : ''}`, { timeoutMs: 45_000 }),
  updates: (refresh = false) => request(`/v1/updates${refresh ? '?refresh=1' : ''}`),
  updateBot: (user) => request('/v1/bot-release/update', {
    method: 'POST',
    timeoutMs: 30_000,
    headers: {
      'X-Discord-User-ID': user.id,
      'X-Discord-User-Name': user.username,
    },
  }),
  rollbackBot: (user) => request('/v1/bot-release/rollback', {
    method: 'POST',
    timeoutMs: 30_000,
    headers: {
      'X-Discord-User-ID': user.id,
      'X-Discord-User-Name': user.username,
    },
  }),
  systemUpdates: (refresh = false) => request(`/v1/system-updates${refresh ? '?refresh=1' : ''}`),
  audit: () => request('/v1/audit'),
  logs: (key) => request(`/v1/logs/${encodeURIComponent(key)}?tail=35`),
  action: (key, action, user) => request(`/v1/services/${encodeURIComponent(key)}/${action}`, {
    method: 'POST',
    headers: {
      'X-Discord-User-ID': user.id,
      'X-Discord-User-Name': user.username,
    },
  }),
  update: (appId, user) => request(`/v1/updates/${encodeURIComponent(appId)}`, {
    method: 'POST',
    timeoutMs: 300_000,
    headers: {
      'X-Discord-User-ID': user.id,
      'X-Discord-User-Name': user.username,
    },
  }),
  updateAll: (user) => request('/v1/updates/all', {
    method: 'POST',
    timeoutMs: 1_800_000,
    headers: {
      'X-Discord-User-ID': user.id,
      'X-Discord-User-Name': user.username,
    },
  }),
  applySystemUpdates: (user) => request('/v1/system-updates/apply', {
    method: 'POST',
    timeoutMs: 20_000,
    headers: {
      'X-Discord-User-ID': user.id,
      'X-Discord-User-Name': user.username,
    },
  }),
  requestSystemReboot: (jobId, user) => request(`/v1/system-updates/reboot?job_id=${encodeURIComponent(jobId || '')}`, {
    method: 'POST',
    timeoutMs: 20_000,
    headers: {
      'X-Discord-User-ID': user.id,
      'X-Discord-User-Name': user.username,
    },
  }),
};
