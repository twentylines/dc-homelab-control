import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { agent } from './agent.js';
import { config } from './config.js';

const selfSignedAgent = new https.Agent({ rejectUnauthorized: false });

function craftyTlsOptions(settings = config) {
  const file = String(settings.craftyCaCertFile || '').trim();
  if (!file) return {};
  let certificate;
  try {
    certificate = readFileSync(file);
  } catch {
    throw new Error('Crafty CA certificate file is configured but cannot be read');
  }
  const text = certificate.toString('utf8');
  if (/-----BEGIN [^-]*PRIVATE KEY-----/i.test(text)) {
    throw new Error('Crafty CA certificate file must contain a public certificate, not a private key');
  }
  if (!/-----BEGIN CERTIFICATE-----/i.test(text)) {
    throw new Error('Crafty CA certificate file is not a PEM certificate');
  }
  const options = { ca: certificate };
  // Crafty commonly generates a certificate for localhost. Only apply an
  // explicit name override alongside a pinned certificate; never weaken the
  // default trust store based on a hostname setting alone.
  if (settings.craftyTlsServername) options.servername = settings.craftyTlsServername;
  return options;
}

function unwrap(payload) {
  return payload?.data ?? payload;
}

function panelUrl(value, fallback = '') {
  const raw = String(value || fallback).trim().replace(/\/$/, '');
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function jsonRequest(baseUrl, path, token, options = {}) {
  return new Promise((resolve, reject) => {
    const base = panelUrl(baseUrl);
    if (!base) return reject(new Error('Minecraft panel URL is invalid'));
    let url;
    try { url = new URL(path, `${base}/`); } catch { return reject(new Error('Minecraft panel endpoint is invalid')); }
    const body = options.body ? JSON.stringify(options.body) : '';
    const transport = url.protocol === 'https:' ? https : http;
    const requestOptions = {
      method: options.method || 'GET',
      timeout: 15_000,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'HomelabControl/0.1',
      },
    };
    if (url.protocol === 'https:' && options.crafty) {
      Object.assign(requestOptions, craftyTlsOptions());
      if (config.craftyAllowInsecureTls && options.allowInsecureTls) requestOptions.agent = selfSignedAgent;
    }
    const request = transport.request(url, requestOptions, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch { /* some action endpoints return an empty body */ }
        if ((response.statusCode || 500) >= 400) {
          return reject(new Error(payload?.errors?.[0]?.detail || payload?.detail || payload?.message || `Minecraft panel HTTP ${response.statusCode}`));
        }
        resolve(payload);
      });
    });
    request.on('timeout', () => request.destroy(new Error('Minecraft panel request timed out')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeResources(resources = {}) {
  const source = resources?.attributes || resources?.data?.attributes || resources?.resources || resources || {};
  const cpu = finiteNumber(source.cpu_absolute ?? source.cpu_percent ?? source.cpu);
  const memory = finiteNumber(source.memory_bytes ?? source.memory_used ?? source.ram);
  const limit = finiteNumber(source.memory_limit_bytes ?? source.memory_limit ?? source.ram_limit);
  const disk = finiteNumber(source.disk_bytes ?? source.disk_used ?? source.storage);
  const rx = finiteNumber(source.network_rx_bytes ?? source.network_rx);
  const tx = finiteNumber(source.network_tx_bytes ?? source.network_tx);
  const pids = finiteNumber(source.pids ?? source.processes);
  const uptime = finiteNumber(source.uptime);
  const result = {};
  if (cpu != null) result.cpu_percent = Math.round(cpu * 10) / 10;
  if (memory != null) result.memory_used = Math.round(memory);
  if (limit != null) result.memory_limit = Math.round(limit);
  if (disk != null) result.disk_used = Math.round(disk);
  if (rx != null) result.network_rx = Math.round(rx);
  if (tx != null) result.network_tx = Math.round(tx);
  if (pids != null) result.pids = Math.round(pids);
  if (uptime != null) result.uptime_seconds = Math.round(uptime / (uptime > 100_000 ? 1000 : 1));
  return result;
}

function normalizeCraftyStats(payload) {
  const source = unwrap(payload) || {};
  const stats = source.stats || source.data || source;
  return normalizeResources({
    ...stats,
    cpu_percent: stats.cpu_percent ?? stats.cpuUsage ?? stats.cpu,
    memory_used: stats.memory_used ?? stats.memoryUsage ?? stats.memory,
    memory_limit: stats.memory_limit ?? stats.memoryLimit,
    disk_used: stats.disk_used ?? stats.diskUsage,
    network_rx: stats.network_rx ?? stats.networkRx,
    network_tx: stats.network_tx ?? stats.networkTx,
    pids: stats.pids ?? stats.processes,
  });
}

function normalizeCraftyServers(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.servers)
      ? payload.servers
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.data?.servers)
          ? payload.data.servers
          : [];
  return list.map((item) => {
    const server = item.server_data || item;
    return {
      id: String(server.server_id ?? server.id ?? item.server_id ?? ''),
      name: String(server.server_name ?? server.name ?? item.server_name ?? 'Minecraft server'),
      running: Boolean(server.running ?? server.stats?.running ?? item.running),
      version: String(server.minecraft_version ?? server.version ?? 'Unknown'),
      type: String(server.type ?? server.server_type ?? 'Minecraft'),
      backend: 'crafty',
      panel: 'Crafty Controller',
      manageable: true,
      raw: item,
    };
  }).filter((server) => server.id);
}

function pterodactylServer(item, panel) {
  const attributes = item?.attributes || item || {};
  const id = String(attributes.identifier || attributes.uuid || attributes.id || item?.id || '');
  const limits = attributes.limits || {};
  return {
    id,
    name: String(attributes.name || 'Minecraft server'),
    running: false,
    version: String(attributes.image || attributes.docker_image || 'Unknown'),
    type: panel === 'pelican' ? 'Pelican server' : 'Pterodactyl server',
    backend: panel,
    panel: panel === 'pelican' ? 'Pelican Panel' : 'Pterodactyl Panel',
    manageable: true,
    limits: {
      memory: finiteNumber(limits.memory),
      cpu: finiteNumber(limits.cpu),
    },
  };
}

function applyPanelResources(server, payload) {
  const source = payload?.attributes || payload?.data?.attributes || payload || {};
  const currentState = String(source.current_state || source.state || '').toLowerCase();
  const resources = normalizeResources(source.resources || source);
  const running = currentState === 'running' || currentState === 'starting' || currentState === 'stopping';
  return { ...server, running, resources, state: currentState || (running ? 'running' : 'offline') };
}

async function pterodactylServers(baseUrl, token, panel, request = jsonRequest) {
  // Pterodactyl's client API lists the authenticated user's servers at
  // /api/client. The resource and control routes below are nested beneath
  // /api/client/servers/{identifier}. Keeping the canonical route here is
  // important: a guessed /api/client/servers list endpoint returns a 404 on
  // standard panels and makes an otherwise healthy integration look broken.
  const payload = await request(baseUrl, '/api/client', token);
  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const servers = list.map((item) => pterodactylServer(item, panel)).filter((server) => server.id);
  // Resource calls are read-only. Keep the panel responsive for larger
  // accounts by sampling at most 32 servers in one view, while retaining the
  // rest of the server list with an explicit unknown-resource state.
  return Promise.all(servers.map(async (server, index) => {
    if (index >= 32) {
      return { ...server, state: 'unknown', resource_error: 'Resource sample skipped after the 32-server safety limit' };
    }
    try {
      const detail = await request(baseUrl, `/api/client/servers/${encodeURIComponent(server.id)}/resources`, token);
      return applyPanelResources(server, detail?.attributes || detail?.data || detail);
    } catch (error) {
      return { ...server, state: 'unknown', resource_error: error.message.slice(0, 140) };
    }
  }));
}

function panelBackend() {
  const requested = String(config.minecraftBackend || 'auto').toLowerCase();
  if (requested === 'none' || requested === 'docker') return null;
  const candidates = [
    { id: 'crafty', url: panelUrl(config.craftyUrl), token: config.craftyToken },
    { id: 'pterodactyl', url: panelUrl(config.pterodactylUrl), token: config.pterodactylToken },
    { id: 'pelican', url: panelUrl(config.pelicanUrl), token: config.pelicanToken },
  ];
  if (requested !== 'auto') {
    return candidates.find((candidate) => candidate.id === requested && candidate.url && candidate.token) || null;
  }
  return candidates.find((candidate) => candidate.url && candidate.token) || null;
}

function panelConfigurationError() {
  const requested = String(config.minecraftBackend || 'auto').toLowerCase();
  if (!['crafty', 'pterodactyl', 'pelican'].includes(requested)) return null;
  const labels = { crafty: 'Crafty', pterodactyl: 'Pterodactyl', pelican: 'Pelican' };
  const values = {
    crafty: [config.craftyUrl, config.craftyToken],
    pterodactyl: [config.pterodactylUrl, config.pterodactylToken],
    pelican: [config.pelicanUrl, config.pelicanToken],
  }[requested];
  if (!panelUrl(values?.[0]) || !values?.[1]) return `${labels[requested]} is selected but its base URL or API token is missing or invalid`;
  return null;
}

async function panelServers(backend) {
  if (backend.id === 'crafty') {
    const payload = await jsonRequest(backend.url, '/api/v2/servers', backend.token, { allowInsecureTls: true, crafty: true });
    return normalizeCraftyServers(payload);
  }
  return pterodactylServers(backend.url, backend.token, backend.id);
}

async function dockerServers() {
  const payload = await agent.minecraft();
  return (payload?.servers || []).map((server) => ({
    id: server.id,
    name: server.label || server.name || 'Minecraft server',
    running: Boolean(server.running),
    state: server.state,
    version: server.image || 'Docker image unknown',
    type: 'Docker Minecraft server',
    backend: 'docker',
    panel: 'Docker discovery',
    manageable: Boolean(server.manageable),
    protected: Boolean(server.protected),
    resources: server.resources || {},
    resource_error: server.resource_error,
    container: server.container,
    detail: server.detail,
  }));
}

function mergeStats(server, stats) {
  const resources = { ...(server.resources || {}), ...(stats || {}) };
  return { ...server, resources };
}

export const minecraft = {
  get configured() { return Boolean(panelBackend()) || config.minecraftBackend !== 'none'; },
  get backend() { return panelBackend()?.id || (config.minecraftBackend === 'none' ? 'none' : 'docker'); },
  async servers() {
    if (config.minecraftBackend === 'none') return [];
    const backend = panelBackend();
    const configurationError = panelConfigurationError();
    if (configurationError) throw new Error(configurationError);
    if (backend) return panelServers(backend);
    return dockerServers();
  },
  async stats(id, server = null) {
    const configurationError = panelConfigurationError();
    if (configurationError) throw new Error(configurationError);
    const backend = panelBackend();
    if (!backend) return server?.resources || {};
    if (backend.id === 'crafty') return normalizeCraftyStats(await jsonRequest(backend.url, `/api/v2/servers/${encodeURIComponent(id)}/stats`, backend.token, { allowInsecureTls: true, crafty: true }));
    const payload = await jsonRequest(backend.url, `/api/client/servers/${encodeURIComponent(id)}/resources`, backend.token);
    return normalizeResources(payload?.attributes || payload?.data || payload);
  },
  async withStats(server) {
    try {
      return mergeStats(server, await this.stats(server.id, server));
    } catch (error) {
      return { ...server, resource_error: error.message.slice(0, 140) };
    }
  },
  async action(id, action, user = null) {
    if (!['start', 'stop', 'restart', 'backup'].includes(action)) throw new Error('Unsupported Minecraft action');
    if (config.minecraftBackend === 'none') throw new Error('Minecraft controls are disabled by configuration');
    const configurationError = panelConfigurationError();
    if (configurationError) throw new Error(configurationError);
    const backend = panelBackend();
    if (!backend) {
      if (!user) throw new Error('A signed-in administrator is required for Docker server actions');
      return agent.action(id, action, user);
    }
    if (backend.id === 'crafty') return jsonRequest(backend.url, `/api/v2/servers/${encodeURIComponent(id)}/action/${action}`, backend.token, { method: 'POST', allowInsecureTls: true, crafty: true });
    if (action === 'backup') return jsonRequest(backend.url, `/api/client/servers/${encodeURIComponent(id)}/backups`, backend.token, { method: 'POST', body: { name: 'Homelab Control backup' } });
    return jsonRequest(backend.url, `/api/client/servers/${encodeURIComponent(id)}/power`, backend.token, { method: 'POST', body: { signal: action } });
  },
  async command(id, command) {
    const configurationError = panelConfigurationError();
    if (configurationError) throw new Error(configurationError);
    const backend = panelBackend();
    if (!backend) throw new Error('Console commands require a configured Crafty, Pterodactyl or Pelican panel');
    if (backend.id === 'crafty') return jsonRequest(backend.url, `/api/v2/servers/${encodeURIComponent(id)}/stdin`, backend.token, { method: 'POST', body: { command }, allowInsecureTls: true, crafty: true });
    return jsonRequest(backend.url, `/api/client/servers/${encodeURIComponent(id)}/command`, backend.token, { method: 'POST', body: { command } });
  },
};

// Keep the old named import working for an existing Hades Control checkout;
// the implementation is now the universal Minecraft manager.
export const crafty = minecraft;

export const minecraftInternals = {
  craftyTlsOptions,
  normalizeResources,
  normalizeCraftyServers,
  normalizeCraftyStats,
  pterodactylServer,
  pterodactylServers,
};
