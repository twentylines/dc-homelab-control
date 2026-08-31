import { config } from './config.js';
import { readSettings } from './settings.js';

const READ_ONLY_COMMANDS = new Set(['panel', 'status', 'services', 'minecraft', 'media', 'storage', 'tasks', 'network', 'controls', 'health', 'report', 'audit', 'updates', 'help', 'ping']);

function hasRole(interaction, roleIds) {
  return roleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
}

function currentLists() {
  const state = readSettings();
  const disabledAdmins = new Set(state.disabledAdminUserIds || []);
  const disabledGuests = new Set(state.disabledGuestUserIds || []);
  const disabledSuperusers = new Set(state.disabledSuperuserIds || []);
  return {
    admins: [...new Set([...config.adminUserIds, ...(state.adminUserIds || [])])].filter((id) => !disabledAdmins.has(id)),
    guests: [...new Set([...config.guestUserIds, ...(state.guestUserIds || [])])].filter((id) => !disabledGuests.has(id)),
    // The configured owner is intentionally unremovable, even if a malformed
    // old overlay contains it in a disabled list.
    superusers: [...new Set([config.ownerId, ...(config.superuserIds || []), ...(state.superuserIds || [])])].filter((id) => id === config.ownerId || !disabledSuperusers.has(id)),
  };
}

export function accessLevel(interaction) {
  if (!interaction.inGuild() || !config.guildIds.includes(interaction.guildId)) return 'none';
  const lists = currentLists();
  if (
    lists.superusers.includes(interaction.user.id)
    || lists.admins.includes(interaction.user.id)
    || hasRole(interaction, config.adminRoleIds)
  ) return 'admin';
  if (
    lists.guests.includes(interaction.user.id)
    || hasRole(interaction, config.guestRoleIds)
  ) return 'guest';
  return 'none';
}

export function canUseCommand(interaction) {
  const level = accessLevel(interaction);
  if (level === 'admin') return true;
  return level === 'guest' && (READ_ONLY_COMMANDS.has(interaction.commandName) || interaction.commandName === 'wake');
}

export function isAdmin(interaction) {
  return accessLevel(interaction) === 'admin';
}

export function isSuperuser(interaction) {
  if (!interaction.inGuild() || !config.guildIds.includes(interaction.guildId)) return false;
  return currentLists().superusers.includes(interaction.user.id);
}

export function accessLists() {
  const lists = currentLists();
  return {
    admins: lists.admins,
    guests: lists.guests,
    superusers: lists.superusers,
  };
}
