import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

// The Runtipi config file is intentionally mounted read-only.  This small
// runtime overlay is the safe place for settings changed from Discord; it
// survives a container recreation without rewriting secrets or environment
// files.
const SETTINGS_FILE = process.env.HOMELAB_CONTROL_SETTINGS_FILE?.trim() || '/data/settings.json';
const ID_RE = /^\d{15,25}$/;
const AUTO_MODES = new Set(['off', 'daily', 'weekly', 'hotfix']);
const IDENTITY_KINDS = ['adminUserIds', 'guestUserIds', 'superuserIds'];
const DISABLED_IDENTITY_FIELDS = {
  adminUserIds: 'disabledAdminUserIds',
  guestUserIds: 'disabledGuestUserIds',
  superuserIds: 'disabledSuperuserIds',
};

function ids(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(',');
  return [...new Set(source.map((value) => String(value || '').trim()).filter((value) => ID_RE.test(value)))].slice(0, 100);
}

// Environment-backed identities and the runtime overlay are deliberately
// additive. This means an administrator can add an identity from Discord
// without hiding a newly supplied identity after the container is recreated.
// Explicit deny lists below still win, so an identity removed in the UI stays
// removed even when it remains in the environment-backed defaults.
function mergeIds(...values) {
  return ids(values.flatMap((value) => Array.isArray(value) ? value : String(value || '').split(',')));
}

function defaultState() {
  return {
    version: 1,
    adminUserIds: ids(config.adminUserIds),
    guestUserIds: ids(config.guestUserIds),
    // The owner is always visible as a protected superuser. access.js also
    // enforces this boundary, but keeping it in the persisted view makes the
    // settings screen truthful and prevents a confusing empty list.
    superuserIds: mergeIds(config.superuserIds, config.ownerId),
    disabledAdminUserIds: [],
    disabledGuestUserIds: [],
    disabledSuperuserIds: [],
    serviceControlMode: config.serviceControlMode,
    releaseChannel: config.releaseChannel,
    autoUpdateMode: config.autoUpdateMode || 'off',
    // Beta is a live-patch route.  Keep automatic updates disabled until an
    // administrator explicitly acknowledges that route from /settings.
    betaAutoUpdateConfirmed: false,
    autoUpdateHour: config.autoUpdateHour ?? 4,
    postUpdateNotice: null,
    updatedAt: null,
  };
}

function normalise(raw = {}) {
  const defaults = defaultState();
  const mode = String(raw.autoUpdateMode || defaults.autoUpdateMode).toLowerCase();
  const hour = Number(raw.autoUpdateHour);
  const disabledAdminUserIds = ids(raw.disabledAdminUserIds ?? defaults.disabledAdminUserIds);
  const disabledGuestUserIds = ids(raw.disabledGuestUserIds ?? defaults.disabledGuestUserIds);
  // The configured owner can never be disabled, even by a stale or manually
  // edited overlay from an older image.
  const disabledSuperuserIds = ids(raw.disabledSuperuserIds ?? defaults.disabledSuperuserIds)
    .filter((id) => id !== config.ownerId);
  return {
    ...defaults,
    // Keep environment defaults and runtime additions together, then hide
    // identities explicitly removed from the environment-backed defaults.
    // This avoids silently losing a new configured ID after a prior overlay
    // has been created while retaining the deny-list across restarts.
    adminUserIds: mergeIds(defaults.adminUserIds, raw.adminUserIds).filter((id) => !disabledAdminUserIds.includes(id)),
    guestUserIds: mergeIds(defaults.guestUserIds, raw.guestUserIds).filter((id) => !disabledGuestUserIds.includes(id)),
    superuserIds: mergeIds(defaults.superuserIds, raw.superuserIds).filter((id) => !disabledSuperuserIds.includes(id)),
    disabledAdminUserIds,
    disabledGuestUserIds,
    disabledSuperuserIds,
    serviceControlMode: ['opt-in', 'opt-out'].includes(String(raw.serviceControlMode || defaults.serviceControlMode).toLowerCase())
      ? String(raw.serviceControlMode || defaults.serviceControlMode).toLowerCase() : defaults.serviceControlMode,
    releaseChannel: ['stable', 'beta'].includes(String(raw.releaseChannel || defaults.releaseChannel).toLowerCase())
      ? String(raw.releaseChannel || defaults.releaseChannel).toLowerCase() : defaults.releaseChannel,
    autoUpdateMode: AUTO_MODES.has(mode) ? mode : 'off',
    // Do not coerce arbitrary strings or numbers into consent.  The settings
    // button writes a real boolean after the administrator has seen the
    // warning, so stale or hand-edited values cannot silently opt in.
    betaAutoUpdateConfirmed: raw.betaAutoUpdateConfirmed === true,
    autoUpdateHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : defaults.autoUpdateHour,
    postUpdateNotice: raw.postUpdateNotice && typeof raw.postUpdateNotice === 'object'
      ? {
        version: String(raw.postUpdateNotice.version || '').slice(0, 40),
        previous: String(raw.postUpdateNotice.previous || '').slice(0, 40),
        at: String(raw.postUpdateNotice.at || '').slice(0, 80),
      } : null,
    updatedAt: raw.updatedAt ? String(raw.updatedAt).slice(0, 80) : null,
  };
}

export function readSettings() {
  try {
    const raw = readFileSync(SETTINGS_FILE, 'utf8');
    // Repair an overly-permissive mode left by an older image when the volume
    // permits it. The file contains Discord IDs and policy, never secrets, but
    // it is still intended to be private to the bot user.
    try { chmodSync(SETTINGS_FILE, 0o600); } catch { /* read-only volume */ }
    return normalise(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function writeSettings(next) {
  const value = normalise({ ...readSettings(), ...next, updatedAt: new Date().toISOString() });
  const directory = dirname(SETTINGS_FILE);
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${SETTINGS_FILE}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, SETTINGS_FILE);
  } catch (error) {
    // Settings remain usable from environment defaults when a read-only
    // development filesystem is used.  Surface the failure to the caller.
    throw new Error(`Settings could not be saved: ${error.message}`);
  }
  return value;
}

export function updateSettings(patch) {
  return writeSettings(patch);
}

export function addIdentity(kind, id) {
  if (!IDENTITY_KINDS.includes(kind)) throw new Error('Unsupported identity list');
  const value = String(id || '').trim();
  if (!ID_RE.test(value)) throw new Error('Enter a Discord user ID (15–25 digits)');
  const state = readSettings();
  const disabledField = DISABLED_IDENTITY_FIELDS[kind];
  return writeSettings({
    [kind]: [...new Set([...state[kind], value])],
    [disabledField]: (state[disabledField] || []).filter((entry) => entry !== value),
  });
}

export function removeIdentity(kind, id) {
  if (!IDENTITY_KINDS.includes(kind)) throw new Error('Unsupported identity list');
  const value = String(id || '').trim();
  const state = readSettings();
  if (kind === 'superuserIds' && value === config.ownerId) throw new Error('The configured owner cannot be removed');
  const configured = kind === 'adminUserIds'
    ? config.adminUserIds
    : kind === 'guestUserIds'
      ? config.guestUserIds
      : [...config.superuserIds, config.ownerId];
  const disabledField = DISABLED_IDENTITY_FIELDS[kind];
  const disabled = configured.includes(value)
    ? [...new Set([...(state[disabledField] || []), value])]
    : (state[disabledField] || []).filter((entry) => entry !== value);
  return writeSettings({
    [kind]: state[kind].filter((entry) => entry !== value),
    [disabledField]: disabled,
  });
}

export function consumePostUpdateNotice() {
  const state = readSettings();
  if (!state.postUpdateNotice) return null;
  try {
    writeSettings({ postUpdateNotice: null });
    return state.postUpdateNotice;
  } catch {
    // Do not show it unless the one-shot claim was persisted. A later command
    // can retry the claim without producing duplicate notices.
    return null;
  }
}

export function markPostUpdateNotice(version, previous) {
  return writeSettings({ postUpdateNotice: {
    version: String(version || '').slice(0, 40),
    previous: String(previous || '').slice(0, 40),
    at: new Date().toISOString(),
  } });
}

export function settingsPath() {
  return SETTINGS_FILE;
}

export const settingsInternals = { ID_RE, AUTO_MODES, IDENTITY_KINDS, DISABLED_IDENTITY_FIELDS, normalise, defaultState };
