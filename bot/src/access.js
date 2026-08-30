import { config } from './config.js';

const READ_ONLY_COMMANDS = new Set(['panel', 'status', 'services', 'minecraft', 'media', 'storage', 'tasks', 'network', 'health', 'report', 'audit', 'updates']);

function hasRole(interaction, roleIds) {
  return roleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
}

export function accessLevel(interaction) {
  if (!interaction.inGuild() || !config.guildIds.includes(interaction.guildId)) return 'none';
  if (
    interaction.user.id === config.ownerId
    || config.adminUserIds.includes(interaction.user.id)
    || hasRole(interaction, config.adminRoleIds)
  ) return 'admin';
  if (
    config.guestUserIds.includes(interaction.user.id)
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
