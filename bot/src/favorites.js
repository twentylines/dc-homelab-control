import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { normalizeMac } from './wol.js';

const file = process.env.WAKE_FAVORITES_FILE || '/data/wake-favorites.json';

function readAll() {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanLabel(value) {
  const label = String(value || '').trim().replace(/[\r\n]/g, ' ').replace(/[`*_]/g, '').slice(0, 48);
  if (!label) throw new Error('Favourite label cannot be empty');
  return label;
}

export function favoriteNames() {
  const names = Object.keys(readAll());
  if (config.wakeDefaultMac && config.wakeDefaultLabel && !names.some((name) => name.toLowerCase() === config.wakeDefaultLabel.toLowerCase())) names.unshift(config.wakeDefaultLabel);
  return names;
}

export function getFavorite(label) {
  const requested = String(label || '').trim().toLowerCase();
  if (!requested) return null;
  const stored = readAll();
  const key = Object.keys(stored).find((name) => name.toLowerCase() === requested);
  if (key) return { label: key, ...stored[key] };
  if (config.wakeDefaultMac && config.wakeDefaultLabel && requested === config.wakeDefaultLabel.toLowerCase()) {
    return { label: config.wakeDefaultLabel, mac: config.wakeDefaultMac, broadcast: config.wakeBroadcast };
  }
  return null;
}

export function saveFavorite(label, mac, broadcast) {
  const cleaned = cleanLabel(label);
  const stored = readAll();
  stored[cleaned] = { mac: normalizeMac(mac), broadcast: broadcast || config.wakeBroadcast };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort on mounted app data */ }
  return cleaned;
}
