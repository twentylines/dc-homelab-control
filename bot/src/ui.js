import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { config } from './config.js';

export const colors = { ok: 0x57f287, warn: 0xfee75c, bad: 0xed4245, idle: 0x5865f2, dark: 0x111827 };

function cleanBrand(value, fallback) {
  const cleaned = String(value || '').replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, 80);
}

export function serverName(data = {}) {
  return cleanBrand(config.serverName || data.hostname, 'Home server');
}

export function botName() {
  return cleanBrand(config.botName, 'Homelab Control');
}

function osInfo(data = {}) {
  const value = data?.os || data?.operating_system || data?.host_os;
  return value && typeof value === 'object' ? value : {};
}

export function operatingSystemLabel(data = {}, fallback = 'Host OS') {
  const os = osInfo(data);
  return cleanBrand(os.pretty_name || os.name || os.id, fallback);
}

export function operatingSystemShortLabel(data = {}, fallback = 'Host') {
  const os = osInfo(data);
  return cleanBrand(os.name || os.pretty_name || os.id, fallback);
}

export function operatingSystemIcon(data = {}) {
  const id = String(osInfo(data).id || '').toLowerCase();
  if (id === 'ubuntu') return '🐧';
  if (id === 'debian' || id === 'linuxmint' || id === 'pop') return '🐧';
  if (id.includes('freebsd') || id === 'openbsd') return '🖥️';
  if (id === 'darwin' || id === 'macos') return '🍎';
  if (id === 'windows') return '🪟';
  return '🖥️';
}

export function backButton(target = 'panel', label = 'Back to panel') {
  return new ButtonBuilder()
    .setCustomId(`nav:${target}`)
    .setLabel(label)
    .setEmoji('⬅️')
    .setStyle(ButtonStyle.Secondary);
}

export function backRow(target = 'panel', label = 'Back to panel') {
  return [new ActionRowBuilder().addComponents(backButton(target, label))];
}

function commandTitle(data, title) {
  return `${serverName(data)} // ${title}`;
}

export function bytes(value) {
  if (!Number.isFinite(Number(value))) return 'Unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = Number(value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(unit < 3 ? 0 : 1)} ${units[unit]}`;
}

export function duration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ') || '<1m';
}

export function percentLabel(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `**${value.toFixed(0)}%**`;
}

function progressSegments(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round(value / 10);
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;
}

export function bar(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `${progressSegments(value)} ${value.toFixed(0)}%`;
}

function meter(label, percent, detail) {
  return `**${label}** · ${percentLabel(percent)}\n${progressSegments(percent)}\n${detail}`;
}

function compactFooter(note = '') {
  const cleaned = String(note || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 240);
}

export function base(title, description = '', footerNote = '') {
  const embed = new EmbedBuilder()
    .setColor(colors.idle)
    .setAuthor({ name: botName() })
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  const footer = compactFooter(footerNote);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

export function helpEmbed() {
  return base(
    `${botName()} // help`,
    'A calm, read-first control surface for your homelab. Commands only show integrations and actions that are actually available on this host.',
    'Read-only command guide · administrators confirm changes',
  )
    .setColor(colors.idle)
    .addFields(
      { name: 'Overview', value: '`/panel` command centre\n`/status` host snapshot\n`/health` concise diagnostic\n`/report` detailed health report\n`/ping` bot response timing', inline: true },
      { name: 'Workloads', value: '`/tasks` live Docker resource view\n`/services` detected containers\n`/media` media providers and playback\n`/minecraft` server status and controls', inline: true },
      { name: 'Operations', value: '`/storage` capacity, SMART and drives\n`/network` detected DNS/network providers\n`/updates` Runtipi, host and bot releases\n`/wake` Wake-on-LAN (saved favourites supported)', inline: true },
      { name: 'Access', value: 'Guests can view read-only commands and use `/wake`. Administrators can confirm service, Minecraft, update and policy changes. `/controls` is opt-out by default: new containers are controllable unless protected or explicitly disabled.', inline: false },
    );
}

export function pingEmbed({ processingMs, websocketMs } = {}) {
  const processing = Number.isFinite(Number(processingMs)) ? `${Math.max(0, Math.round(Number(processingMs))).toLocaleString('en-GB')} ms` : 'not measured';
  const gateway = Number.isFinite(Number(websocketMs)) && Number(websocketMs) >= 0
    ? `${Math.round(Number(websocketMs)).toLocaleString('en-GB')} ms`
    : 'not reported';
  return base(
    `${botName()} // ping`,
    `🟢 **Response received**\nBot processing · **${processing}**\nDiscord gateway · **${gateway}**`,
    'Measured locally when the command was handled · no host probe was performed',
  ).setColor(colors.ok);
}

function memoryPercent(data) {
  return data.memory?.total ? (data.memory.used / data.memory.total) * 100 : 0;
}

function frequency(data) {
  const value = Number(data.specs?.observed_ghz);
  return Number.isFinite(value) ? `${value.toFixed(2)} GHz` : 'GHz unavailable';
}

function memorySpeed(data) {
  const speeds = data.specs?.ram_speed_mhz;
  if (!Array.isArray(speeds) || !speeds.length) return 'RAM speed unavailable';
  const unique = [...new Set(speeds.map((value) => Number(value)).filter((value) => Number.isFinite(value)))];
  return unique.length === 1 ? `${unique[0]} MHz` : `${unique.join(' / ')} MHz`;
}

function loadAverage(data, includeLong = false) {
  const values = Array.isArray(data.load) ? data.load : [];
  const format = (value) => {
    if (!Number.isFinite(Number(value))) return '—';
    return Number(value).toFixed(2).replace(/^0(?=\.)/, '');
  };
  const selected = includeLong ? values.slice(0, 3) : values.slice(0, 2);
  return selected.map(format).join(' / ') || '—';
}

function temperature(data) {
  return data.temperature_c == null ? 'Temperature unavailable' : `${data.temperature_c.toFixed(0)}°C`;
}

function cpuDetail(data, includeLongLoad = false) {
  const loadLabel = includeLongLoad ? '1/5/15m' : '1/5m';
  return `**Frequency** · ${frequency(data)}\n**Temperature** · ${temperature(data)}\n**Load ${loadLabel}** · ${loadAverage(data, includeLongLoad)}`;
}

function diskSummary(data) {
  return (data.storage || []).map((disk) => `**${disk.label} — ${bytes(disk.total)}**\n${percentLabel(disk.percent)} used\n${bytes(disk.used)} used • ${bytes(disk.free)} free`).join('\n\n') || 'No storage data';
}

function driveSummary(data) {
  if (!data.drives?.length) return '⚪ Scrutiny data unavailable';
  return data.drives.map((drive) => `${drive.critical ? '🔴' : drive.warning ? '🟠' : '🟢'} **${drive.model}**\n${drive.state}${drive.temperature_c == null ? '' : ` • ${drive.temperature_c.toFixed(0)}°C`}`).join('\n\n');
}

function serviceHealth(service) {
  if (service.health === 'healthy') return service.health_source === 'docker' ? 'healthy' : 'reachable';
  if (service.health === 'unhealthy') return 'unhealthy';
  if (service.health === 'unreachable') return 'unreachable';
  if (service.health === 'starting') return 'starting';
  if (service.health === 'process') return 'process alive';
  return 'unavailable';
}

function serviceLine(service) {
  const failed = service.health === 'unhealthy' || service.health === 'unreachable' || service.state !== 'running';
  return `${failed ? '🔴' : '🟢'} ${service.label} — ${service.state} • ${serviceHealth(service)}`;
}

function lineChunks(lines, maximum = 1000) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (current && candidate.length > maximum) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function mediaLine(item) {
  const latency = Number.isFinite(Number(item.latency_ms))
    ? ` · ${item.probe_type ? `${safeUpdateText(item.probe_type, 30)} ` : ''}${Math.round(Number(item.latency_ms)).toLocaleString('en-GB')} ms`
    : '';
  return `${item.online ? '🟢' : '🔴'} **${item.label}** — ${item.online ? `online${latency}` : 'unreachable'}`;
}

export function assessment(data, services = [], media = [], mediaSummary = null) {
  const issues = [];
  const recommendations = [];
  const memory = memoryPercent(data);
  if (data.temperature_c != null && data.temperature_c >= 85) issues.push(`CPU temperature is ${data.temperature_c.toFixed(0)}°C`);
  else if (data.temperature_c != null && data.temperature_c >= 75) recommendations.push('Watch CPU temperature under a sustained load');
  if (memory >= 90) issues.push(`Memory is ${memory.toFixed(0)}% used`);
  else if (memory >= 75) recommendations.push(`Memory is ${memory.toFixed(0)}% used`);
  const fullDisks = (data.storage || []).filter((disk) => disk.percent >= 90);
  if (fullDisks.length) issues.push(`${fullDisks.map((disk) => disk.label).join(' and ')} nearly full`);
  else if ((data.storage || []).some((disk) => disk.percent >= 75)) recommendations.push('Review storage before it reaches 90%');
  const unhealthy = (services || []).filter((service) => service.health === 'unhealthy' || service.health === 'unreachable');
  const stopped = (services || []).filter((service) => service.container && service.state !== 'running');
  if (unhealthy.length) issues.push(`Unhealthy service: ${unhealthy.map((service) => service.label).join(', ')}`);
  if (stopped.length) recommendations.push(`Stopped services: ${stopped.map((service) => service.label).join(', ')}`);
  const offline = (media || []).filter((item) => !item.online);
  if (offline.length) issues.push(`Media endpoint offline: ${offline.map((item) => item.label).join(', ')}`);
  if (mediaSummary?.assessed === true && mediaSummary.complete === false) {
    const missing = Array.isArray(mediaSummary.missing) && mediaSummary.missing.length ? mediaSummary.missing.join(', ') : 'required providers';
    recommendations.push(`Media stack incomplete: add ${missing}`);
  }
  const driveProblems = (data.drives || []).filter((drive) => drive.warning);
  if (driveProblems.length) issues.push(`Drive warning: ${driveProblems.map((drive) => drive.model).join(', ')}`);
  if (data.memory?.swap_total && data.memory.swap_used / data.memory.swap_total > 0.5) recommendations.push('Swap activity is elevated; check memory-heavy workloads');
  const critical = (data.drives || []).some((drive) => drive.critical) || (data.storage || []).some((disk) => disk.percent >= 95) || (data.temperature_c != null && data.temperature_c >= 90);
  return { issues, recommendations, critical, color: critical ? colors.bad : issues.length ? colors.warn : colors.ok, label: critical ? 'Critical attention required' : issues.length ? 'Attention recommended' : 'All monitored systems healthy' };
}

export function statusEmbed(data) {
  const memoryPct = memoryPercent(data);
  const hasProblem = data.containers.running !== data.containers.total || data.containers.unhealthy.length;
  return base(commandTitle(data, 'system overview'), hasProblem ? '⚠️ Attention is needed' : '● All core systems nominal', 'Live host and container status')
    .setColor(hasProblem ? colors.warn : colors.ok)
    .addFields(
      { name: 'CPU', value: meter('Utilisation', data.cpu_percent, cpuDetail(data)), inline: true },
      { name: 'Memory', value: meter('Used', memoryPct, `${bytes(data.memory.used)} / ${bytes(data.memory.total)}`), inline: true },
      { name: 'Uptime', value: duration(data.uptime_seconds), inline: true },
      { name: `${operatingSystemIcon(data)} Operating system`, value: operatingSystemLabel(data), inline: false },
      { name: 'Containers', value: `**${data.containers.running}/${data.containers.total}** running${data.containers.unhealthy.length ? `\nUnhealthy: ${data.containers.unhealthy.join(', ')}` : ''}`, inline: false },
    );
}

export function panelEmbed(data, services, media, updates = null, mediaSummary = null) {
  const result = assessment(data, services, media, mediaSummary);
  const memory = memoryPercent(data);
  const onlineMedia = media.filter((item) => item.online).length;
  const trackedRunning = services.filter((item) => item.container && item.state === 'running').length;
  const updateCount = Array.isArray(updates?.updates) ? updates.updates.length : null;
  const updateState = updates?.available === false ? '⚪ Check unavailable' : updateCount ? `🟡 ${updateCount} available` : '🟢 Up to date';
  return base(commandTitle(data, 'control centre'), `${result.critical ? '🔴' : result.issues.length ? '🟡' : '🟢'} **${result.label}**\nYour live command centre for the home server.`, 'Home-server control panel')
    .setColor(result.color)
    .addFields(
      { name: 'Live now', value: `${meter('CPU', data.cpu_percent, cpuDetail(data))}\n\n${meter('Memory', memory, `${bytes(data.memory.used)} / ${bytes(data.memory.total)}`)}\n\n**Uptime** ${duration(data.uptime_seconds)}`, inline: true },
      { name: 'Fleet signal', value: `**Docker** ${data.containers.running}/${data.containers.total}\n**Tracked** ${trackedRunning}/${data.containers.tracked_total}${media.length ? `\n**Media** ${onlineMedia}/${media.length} reachable${mediaSummary?.assessed === true ? `\n${mediaSummary.complete ? '🟢 Complete' : '🟡 Incomplete'}` : ''}` : ''}`, inline: true },
      { name: 'Software', value: `**Runtipi** ${updateState}\nUse \`/updates\` for guarded one-at-a-time or update-all actions.`, inline: true },
      { name: `${operatingSystemIcon(data)} Operating system`, value: operatingSystemLabel(data), inline: true },
      { name: 'Capacity', value: diskSummary(data), inline: false },
      { name: 'Control shortcuts', value: '`/health` diagnostic\n`/report` detailed report\n`/tasks` Docker RAM/CPU breakdown\n`/services` service controls\n`/minecraft` Minecraft controls\n`/storage` capacity + SMART\n`/wake mac:...` Wake-on-LAN', inline: true },
      { name: 'Next best action', value: result.issues[0] ? `⚠️ ${result.issues[0]}` : result.recommendations[0] ? `💡 ${result.recommendations[0]}` : '✅ No action needed right now.', inline: true },
    );
}

const loadingGlyphs = ['◐', '◓', '◑', '◒'];

export function loadingEmbed(title, stage = 0, tick = 0, options = {}) {
  const steps = Array.isArray(options.steps) && options.steps.length
    ? options.steps
    : ['Requesting a read-only snapshot', 'Waiting for the control agent response', 'Formatting the returned data'];
  const currentStage = Math.max(0, Math.min(steps.length - 1, Number(stage) || 0));
  const tickValue = Math.max(0, Number(tick) || 0);
  const glyph = loadingGlyphs[tickValue % loadingGlyphs.length];
  const dots = '.'.repeat((tickValue % 3) + 1);
  const elapsed = Number.isFinite(Number(options.elapsedSeconds))
    ? ` · ${Math.max(0, Number(options.elapsedSeconds)).toFixed(0)}s elapsed`
    : '';
  const phase = options.phase || 'Request in flight';
  const detail = options.detail || 'Read-only request · no service changes are being made';
  return base(title, `${glyph} **${safeUpdateText(phase, 100)}${dots}**${elapsed}\n⏳ ${safeUpdateText(steps[currentStage], 220)}\n${safeUpdateText(detail, 300)}`, options.footerNote || 'Read-only command request').setColor(colors.idle);
}

function safeUpdateText(value, maximum = 180) {
  return String(value || 'Unknown').replace(/[\\`*_~|\r\n@]/g, '').slice(0, maximum);
}

function rollbackActionLabel(version) {
  if (!version) return 'Revert version';
  const cleanVersion = safeUpdateText(version, 20).replace(/^v/i, '');
  return cleanVersion && cleanVersion !== 'Unknown' ? `Revert to v${cleanVersion}` : 'Revert version';
}

function updateVersionLine(update) {
  const current = safeUpdateText(update.current || 'unknown', 50);
  const latest = safeUpdateText(update.latest || 'unknown', 70);
  return `**${safeUpdateText(update.label || update.id, 80)}** · ${current} → ${latest}`;
}

function botReleasePhase(release) {
  return safeUpdateText(String(release?.phase || 'idle').replace(/_/g, ' '), 48)
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function botRollbackLine(release) {
  if (!release?.rollback_available) return null;
  const source = release.rollback_source === 'github'
    ? 'from GitHub'
    : release.github_rollback_available
      ? 'retained locally · GitHub fallback ready'
      : 'retained locally';
  return `↩️ Revert available · ${safeUpdateText(release.rollback_version || 'previous version', 40)} · ${source}`;
}

export function botReleaseSummary(release) {
  if (!release?.configured) {
    return `⚪ **Release checks not configured**\n${safeUpdateText(release?.detail || 'Set HOMELAB_CONTROL_REPOSITORY to enable checks.', 280)}`;
  }
  if (release.available === false) {
    const lines = [`🟡 **GitHub check unavailable**`, safeUpdateText(release.detail || 'GitHub did not return release metadata.', 280)];
    const rollbackLine = botRollbackLine(release);
    if (rollbackLine) lines.push(rollbackLine);
    return lines.join('\n').slice(0, 1024);
  }
  const current = safeUpdateText(release.current || 'unknown', 40);
  const latest = safeUpdateText(release.latest || current, 40);
  const active = ['queued', 'checking', 'downloading', 'verifying', 'staging', 'building', 'restarting', 'verifying_runtime'].includes(release.phase);
  const lines = active
    ? [`◓ **${botReleasePhase(release)}**`, `Current · **${current}**${latest !== current ? ` · target **${latest}**` : ''}`]
    : release.update_available
      ? [`🟡 **Update available**`, `Current · **${current}**`, `Latest · **${latest}**`]
      : [`🟢 **Up to date**`, `Version · **${current}**`];
  if (release.update_available && !release.asset_verified) lines.push('🔒 Update held · the release archive has no verified SHA-256 digest');
  else if (release.update_available && !release.update_supported) lines.push('🔒 Update held · the guarded host release bridge is not configured');
  else if (release.update_available && !active) lines.push('✅ Verified archive ready to install');
  const rollbackLine = botRollbackLine(release);
  if (rollbackLine) lines.push(rollbackLine);
  else if (release.github_rollback_detail) {
    lines.push(`↩️ GitHub revert unavailable · ${safeUpdateText(release.github_rollback_detail, 220)}`);
  }
  if (release.detail && !/latest stable release|newer verified release is ready/i.test(String(release.detail))) {
    lines.push(safeUpdateText(release.detail, 280));
  }
  return lines.join('\n').slice(0, 1024);
}

export function hostUpdateSummary(snapshot) {
  const hasOs = Object.keys(osInfo(snapshot)).length > 0;
  // Older bridge snapshots predate the OS field and are known to be Ubuntu
  // snapshots. New snapshots always carry an explicit identity.
  const osLabel = operatingSystemLabel(snapshot, hasOs ? 'Host operating system' : 'Ubuntu');
  const osShort = operatingSystemShortLabel(snapshot, hasOs ? 'Host' : 'Ubuntu');
  if (!snapshot || snapshot.available === false) {
    return `⚪ **${osLabel}** update check unavailable\n${safeUpdateText(snapshot?.detail || 'The host did not return update status.', 260)}`;
  }
  const pending = snapshot.pending_count == null ? 'unknown' : Number(snapshot.pending_count).toLocaleString('en-GB');
  const packages = Array.isArray(snapshot.packages) ? snapshot.packages : [];
  const inferredSecurity = snapshot.security_count == null && packages.some((item) => Object.prototype.hasOwnProperty.call(item, 'security'))
    ? packages.filter((item) => item.security).length
    : snapshot.security_count;
  const security = inferredSecurity == null
    ? 'Not reported'
    : `${Number(inferredSecurity).toLocaleString('en-GB')} update${Number(inferredSecurity) === 1 ? '' : 's'}`;
  const phase = safeUpdateText(String(snapshot.phase || 'idle').replace(/_/g, ' '), 40);
  const phaseLabel = phase.replace(/\b\w/g, (letter) => letter.toUpperCase());
  const isUbuntu = !hasOs || String(osInfo(snapshot).id || '').toLowerCase() === 'ubuntu' || /ubuntu/i.test(osLabel);
  const esmNotice = isUbuntu && /expanded security maintenance for applications|esm apps/i.test(String(snapshot.notice || ''));
  const statusIcon = ['checking', 'applying', 'rebooting'].includes(snapshot.phase) ? '🟣' : snapshot.phase === 'failed' ? '🔴' : snapshot.pending_count > 0 ? '🟡' : '🟢';
  const lines = [
    `${statusIcon} **${pending} pending**`,
    `**Security** · ${security}`,
    `**Phase** · ${phaseLabel}${snapshot.reboot_required ? ' · **restart required**' : ''}`,
  ];
  if (isUbuntu && (snapshot.esm_enabled === false || esmNotice)) {
    lines.push('ℹ️ **Ubuntu Pro / ESM Apps** · optional · not enabled');
  } else if (isUbuntu && snapshot.esm_enabled === true) {
    lines.push('🛡️ **Ubuntu Pro / ESM Apps** · enabled');
  }
  if (snapshot.security_detail) lines.push(`🔐 **Security detail** · ${safeUpdateText(snapshot.security_detail, 220)}`);
  if (packages.length) {
    const packageLines = packages.slice(0, 12).map((item) => {
      const icon = item.security ? '🔐' : '📦';
      const name = safeUpdateText(item.name || 'package', 54);
      const latest = safeUpdateText(item.latest || 'version unavailable', 70);
      const origin = item.origin ? ` · ${safeUpdateText(item.origin, 70)}` : '';
      return `${icon} ${name} → ${latest}${origin}`;
    }).join('\n');
    lines.push(`**Planned packages**\n${packageLines}`.slice(0, 760));
  }
  const deferred = Array.isArray(snapshot.deferred_packages) ? snapshot.deferred_packages : [];
  if (deferred.length) lines.push(`⏸️ **Deferred by ${osShort} phasing** · ${deferred.map((name) => safeUpdateText(name, 54)).join(', ').slice(0, 360)}`);
  if (snapshot.notice && !esmNotice) lines.push(`ℹ️ ${safeUpdateText(snapshot.notice, 220)}`);
  if (!snapshot.maintenance_available) lines.push('🔒 Admin maintenance actions are not installed on the host.');
  if (snapshot.detail) lines.push(safeUpdateText(snapshot.detail, 240));
  return lines.join('\n').slice(0, 1024);
}

function hostUpdateFieldName(snapshot, suffix = 'host') {
  const hasOs = Object.keys(osInfo(snapshot)).length > 0;
  return `${hasOs ? operatingSystemIcon(snapshot) : '🐧'} ${operatingSystemLabel(snapshot, hasOs ? 'Host' : 'Ubuntu')} ${suffix}`.slice(0, 256);
}

export function updatesEmbed(snapshot, systemUpdates = null) {
  if (!snapshot?.available) {
    const unavailable = base(
      'Runtipi // software updates',
      `🟡 **Update checks unavailable**\n${safeUpdateText(snapshot?.detail || 'Runtipi did not return an update status.')}`,
      'No update attempted · restore Runtipi connection, then refresh',
    ).setColor(colors.warn);
    if (systemUpdates) unavailable.addFields({ name: hostUpdateFieldName(systemUpdates), value: hostUpdateSummary(systemUpdates), inline: false });
    if (snapshot?.bot) unavailable.addFields({ name: '🤖 Homelab Control release', value: botReleaseSummary(snapshot.bot), inline: false });
    return unavailable;
  }
  const updates = Array.isArray(snapshot.updates) ? snapshot.updates : [];
  const protectedUpdates = Array.isArray(snapshot.protected_updates) ? snapshot.protected_updates : [];
  const lines = updates.map(updateVersionLine).join('\n').slice(0, 1024) || '✅ All eligible apps are up to date.';
  const protectedLine = protectedUpdates.length
    ? `${protectedUpdates.map(updateVersionLine).join('\n').slice(0, 700)}\n\nThe controller stays protected so it remains available while other apps update.`
    : 'The controller is protected from update-all actions.';
  const embed = base(
    'Runtipi // software updates',
    `${updates.length ? '🟡' : '🟢'} **${updates.length ? `${updates.length} update${updates.length === 1 ? '' : 's'} available` : 'All eligible apps are current'}**\nChecked ${snapshot.checked_at ? `<t:${Math.floor(new Date(snapshot.checked_at).getTime() / 1000)}:R>` : 'just now'}`,
    'Runtipi lifecycle · backup requested · Docker/app ping verifies completion',
  )
    .setColor(updates.length ? colors.warn : colors.ok)
    .addFields(
      { name: `Available updates · ${updates.length}`, value: lines, inline: false },
      { name: 'Protected scope', value: protectedLine, inline: false },
    );
  if (systemUpdates) embed.addFields({ name: hostUpdateFieldName(systemUpdates), value: hostUpdateSummary(systemUpdates), inline: false });
  if (snapshot.bot) embed.addFields({ name: '🤖 Homelab Control release', value: botReleaseSummary(snapshot.bot), inline: false });
  return embed;
}

export function updatesRows(snapshot, systemOrAllow = null, actions = true) {
  let systemUpdates = systemOrAllow;
  let allowActions = actions;
  if (typeof systemOrAllow === 'boolean') {
    allowActions = systemOrAllow;
    systemUpdates = null;
  }
  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('updates:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    backButton('panel'),
  )];
  if (allowActions && systemUpdates?.maintenance_available && systemUpdates?.update_supported !== false) {
    const active = ['checking', 'applying', 'rebooting'].includes(systemUpdates.phase);
    if (systemUpdates.phase === 'ready_for_reboot') {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('updates:system-reboot').setLabel('Restart host').setEmoji('🔁').setStyle(ButtonStyle.Danger),
      ));
    } else if (!active && Number(systemUpdates.pending_count) > 0) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('updates:system-apply').setLabel(`Apply ${operatingSystemShortLabel(systemUpdates, 'host')} updates`).setEmoji(operatingSystemIcon(systemUpdates)).setStyle(ButtonStyle.Success),
      ));
    }
  }
  const botRelease = snapshot?.bot;
  const botActions = [];
  if (allowActions && botRelease?.configured && botRelease.update_available && botRelease.asset_verified && botRelease.update_supported) {
    botActions.push(new ButtonBuilder().setCustomId('updates:bot-update').setLabel(`Update bot · ${safeUpdateText(botRelease.latest || 'latest', 24)}`).setEmoji('🤖').setStyle(ButtonStyle.Success));
  }
  if (allowActions && botRelease?.rollback_available && botRelease.update_supported) {
    botActions.push(new ButtonBuilder().setCustomId('updates:bot-rollback').setLabel(rollbackActionLabel(botRelease.rollback_version)).setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  }
  if (botActions.length) rows.push(new ActionRowBuilder().addComponents(botActions));
  const updates = Array.isArray(snapshot?.updates) ? snapshot.updates : [];
  if (!allowActions || !updates.length) return rows;
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('updates:update-all').setLabel(`Update all · ${updates.length}`).setEmoji('⬆️').setStyle(ButtonStyle.Success),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('updates:select')
      .setPlaceholder('Choose one app to update')
      .addOptions(updates.slice(0, 25).map((update) => ({
        label: safeUpdateText(update.label || update.id, 100),
        value: safeUpdateText(update.id, 100),
        description: `${safeUpdateText(update.current, 35)} → ${safeUpdateText(update.latest, 55)}`.slice(0, 100),
      }))),
  ));
  return rows;
}

function maintenanceEventLines(snapshot) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  if (!events.length) return 'Waiting for the host bridge…';
  return events.slice(-6).map((event) => `• ${safeUpdateText(event.message, 180)}`).join('\n').slice(0, 1024);
}

export function systemUpdateLoadingEmbed(snapshot, tick = 0) {
  const tickValue = Math.max(0, Number(tick) || 0);
  const glyph = loadingGlyphs[tickValue % loadingGlyphs.length];
  const dots = '.'.repeat((tickValue % 3) + 1);
  const phase = snapshot?.phase || 'queued';
  const phaseLabel = safeUpdateText(phase, 40).replace(/_/g, ' ');
  const osLabel = operatingSystemShortLabel(snapshot, Object.keys(osInfo(snapshot)).length ? 'host' : 'Ubuntu');
  return base(
    `${osLabel} // guarded maintenance`,
    `${glyph} **${phaseLabel}${dots}**\n⏳ The guarded host bridge is processing the confirmed request.\nNo automatic restart will be performed.`,
    `${osLabel} maintenance · configuration kept · restart requires confirmation`,
  )
    .setColor(colors.idle)
    .addFields(
      { name: 'Live feed', value: maintenanceEventLines(snapshot), inline: false },
      { name: 'Package scope', value: `${snapshot?.pending_count == null ? 'Checking' : `${snapshot.pending_count} pending`} · ${snapshot?.security_count == null ? 'security count pending' : `${snapshot.security_count} security`}`, inline: true },
    );
}

export function systemUpdateResultEmbed(snapshot) {
  const phase = snapshot?.phase || 'failed';
  const complete = phase === 'complete';
  const waiting = phase === 'ready_for_reboot';
  const failed = phase === 'failed';
  const osLabel = operatingSystemShortLabel(snapshot, Object.keys(osInfo(snapshot)).length ? 'Host' : 'Ubuntu');
  const icon = complete ? '🟢' : waiting ? '🟡' : failed ? '🔴' : '🟣';
  const headline = complete ? `${osLabel} updates applied` : waiting ? `${osLabel} updates applied — restart pending` : failed ? `${osLabel} update failed` : `${osLabel} maintenance ${safeUpdateText(phase, 40)}`;
  const lines = [
    `${icon} **${headline}**`,
    `${snapshot?.pending_count == null ? 'Pending count unknown' : `${snapshot.pending_count} pending`} · ${snapshot?.security_count == null ? 'security count unknown' : `${snapshot.security_count} security`}`,
  ];
  if (snapshot?.reboot_required) lines.push('🔁 A restart is required and must be confirmed separately.');
  if (snapshot?.notice) lines.push(`⚠️ ${safeUpdateText(snapshot.notice, 220)}`);
  if (snapshot?.detail) lines.push(safeUpdateText(snapshot.detail, 240));
  return base(
    `${osLabel} // maintenance result`,
    lines.join('\n'),
    snapshot?.reboot_required ? `${osLabel} update result · restart is separate` : `${osLabel} update result · no automatic restart`,
  )
    .setColor(complete ? colors.ok : failed ? colors.bad : colors.warn)
    .addFields({ name: 'Recent activity', value: maintenanceEventLines(snapshot), inline: false });
}

export function updateLoadingEmbed(title, stage = 0, tick = 0, detail = '') {
  const steps = ['Re-checking the Runtipi catalogue', 'Requesting backup + update', 'Waiting for Docker to settle', 'Pinging the updated container'];
  const currentStage = Math.max(0, Math.min(steps.length - 1, Number(stage) || 0));
  const tickValue = Math.max(0, Number(tick) || 0);
  const glyph = loadingGlyphs[tickValue % loadingGlyphs.length];
  const dots = '.'.repeat((tickValue % 3) + 1);
  const suffix = detail ? safeUpdateText(detail, 500) : 'Read-only status feed · no restart is automatic';
  return base(title, `${glyph} **${safeUpdateText(steps[currentStage], 180)}${dots}**\n⏳ ${suffix}\n⏱️ About ${Math.max(0, Math.round(tickValue * 2.2))}s elapsed`, 'Runtipi update in progress').setColor(colors.idle);
}

const botReleaseStages = {
  queued: 'Waiting for the guarded host bridge',
  checking: 'Checking the selected GitHub release',
  downloading: 'Downloading the release archive',
  verifying: 'Verifying the SHA-256 digest',
  staging: 'Staging the verified source tree',
  building: 'Building the control images',
  restarting: 'Restarting the control containers',
  verifying_runtime: 'Checking agent and bot health',
  complete: 'Release applied and verified',
  rolled_back: 'Previous release restored and verified',
  failed: 'Release action stopped safely',
};

export function botReleaseLoadingEmbed(action, release, tick = 0) {
  const tickValue = Math.max(0, Number(tick) || 0);
  const glyph = loadingGlyphs[tickValue % loadingGlyphs.length];
  const dots = '.'.repeat((tickValue % 3) + 1);
  const phase = String(release?.phase || 'queued').toLowerCase();
  const stage = botReleaseStages[phase] || `Host bridge phase: ${phase.replace(/_/g, ' ')}`;
  const target = release?.latest || release?.requested_version || release?.rollback_version || release?.version || 'selected release';
  const events = Array.isArray(release?.events) && release.events.length
    ? release.events.slice(-5).map((event) => `• ${safeUpdateText(event.message, 180)}`).join('\n')
    : 'Waiting for the host bridge to report its first step…';
  const actionLabel = action === 'rollback' ? 'Reverting Homelab Control' : 'Updating Homelab Control';
  return base(
    `Homelab Control // ${actionLabel}`,
    `${glyph} **${safeUpdateText(stage, 180)}${dots}**\nTarget · **${safeUpdateText(target, 60)}**\n⏳ The bot will report completion only after both control containers answer their health checks.`,
    'Guarded release workflow · no other containers are changed',
  ).setColor(colors.idle).addFields({ name: 'Live feed', value: events.slice(0, 1024), inline: false });
}

export function botReleaseResultEmbed(action, release) {
  const phase = String(release?.phase || 'failed').toLowerCase();
  const complete = phase === 'complete' || phase === 'rolled_back';
  const icon = complete ? '🟢' : '🔴';
  const headline = phase === 'rolled_back' ? 'Previous bot release restored' : phase === 'complete' ? 'Bot update verified' : 'Bot update stopped safely';
  const version = release?.current || release?.latest || release?.rollback_version || 'unknown';
  const lines = [`${icon} **${headline}**`, `Running version · **${safeUpdateText(version, 60)}**`];
  if (action === 'rollback' && release?.rollback_source) {
    lines.push(`Rollback source · **${release.rollback_source === 'github' ? 'GitHub archive' : 'retained local images'}**`);
  }
  if (release?.previous_version) lines.push(`Previous version · ${safeUpdateText(release.previous_version, 60)}`);
  if (release?.detail) lines.push(safeUpdateText(release.detail, 320));
  const events = Array.isArray(release?.events) && release.events.length
    ? release.events.slice(-6).map((event) => `• ${safeUpdateText(event.message, 180)}`).join('\n')
    : 'No host bridge events were returned.';
  return base(
    `Homelab Control // ${action === 'rollback' ? 'rollback result' : 'update result'}`,
    lines.join('\n'),
    'Guarded release workflow · control containers verified',
  ).setColor(complete ? colors.ok : colors.bad).addFields({ name: 'Recent activity', value: events.slice(0, 1024), inline: false });
}

function updateResultIcon(status, verified) {
  if (status === 'updated' && verified) return '🟢';
  if (status === 'current') return '🟢';
  if (status === 'skipped' || status === 'attention') return '🟡';
  return '🔴';
}

function updateResultLine(result) {
  const icon = updateResultIcon(result.status, result.verified);
  const label = safeUpdateText(result.label || result.id || 'App', 80);
  const detail = result.detail ? ` — ${safeUpdateText(result.detail, 140)}` : '';
  const latency = result.verified ? verificationLatency(result) : null;
  const verification = result.verified ? ` · ${latency || 'verification latency unavailable'}` : '';
  return `${icon} **${label}** · ${safeUpdateText(result.status || 'unknown', 30)}${verification}${detail}`;
}

function verificationLatency(result) {
  const explicit = Number(result?.verification?.latency_ms);
  if (Number.isFinite(explicit) && explicit >= 0) return `${Math.round(explicit)} ms`;
  const detail = String(result?.verification?.detail || '');
  const match = detail.match(/(?:^|[•·])\s*(\d+(?:\.\d+)?)\s*ms\b/i);
  return match ? `${Math.round(Number(match[1]))} ms` : null;
}

export function updateResultEmbed(result) {
  if (Array.isArray(result?.results)) {
    const successful = Number(result.successful || 0);
    const failed = Number(result.failed || 0);
    const skipped = Number(result.skipped || 0);
    const lines = result.results.map(updateResultLine).join('\n').slice(0, 1024) || 'No eligible updates were attempted.';
    const protectedLine = Array.isArray(result.protected_updates) && result.protected_updates.length
      ? `\nProtected: ${result.protected_updates.map((item) => safeUpdateText(item.label || item.id, 70)).join(', ')}`
      : '';
    const ok = result.status === 'updated' && result.verified;
    return base(
      'Runtipi // update all',
      `${ok ? '🟢' : '🟡'} **${successful} verified · ${failed} failed · ${skipped} skipped**`,
      'Runtipi updates · backup requested · Docker/app ping required before verified',
    )
      .setColor(ok ? colors.ok : colors.warn)
      .addFields(
        { name: 'Results', value: lines, inline: false },
        { name: 'Protected scope', value: protectedLine, inline: false },
      );
  }
  const icon = updateResultIcon(result?.status, result?.verified);
  const label = safeUpdateText(result?.label || result?.id || 'Runtipi app', 100);
  const version = result?.latest ? `\nVersion target: **${safeUpdateText(result.latest, 90)}**` : '';
  const verification = result?.verification?.detail ? `\n${safeUpdateText(result.verification.detail, 300)}` : '';
  const latency = result?.verified ? verificationLatency(result) : null;
  const summary = result?.status === 'updated' && result?.verified
    ? `${icon} **Update verified**\nDocker is running and the post-update ping succeeded${latency ? ` in **${latency}**` : ''}.`
    : `${icon} **${safeUpdateText(result?.status || 'Update did not complete', 60)}**\n${safeUpdateText(result?.detail || 'No update was confirmed.', 500)}`;
  const embed = base(
    `Runtipi // ${label}`,
    `${summary}${version}${verification}`,
    'Runtipi update verification · Docker/app ping completed',
  )
    .setColor(result?.status === 'updated' && result?.verified ? colors.ok : result?.status === 'current' ? colors.ok : colors.warn);
  return embed;
}

export function updateResultRows() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('updates:back').setLabel('Back to updates').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
    backButton('panel'),
  )];
}

export function healthEmbed(data, services, media, mediaSummary = null) {
  const result = assessment(data, services, media, mediaSummary);
  const memory = memoryPercent(data);
  const swap = data.memory?.swap_total ? `${bytes(data.memory.swap_used)} / ${bytes(data.memory.swap_total)}` : 'Disabled';
  const tracked = services.filter((service) => service.container);
  const runningServices = tracked.filter((service) => service.state === 'running').length;
  const onlineMedia = media.filter((item) => item.online).length;
  const serviceLines = tracked.map(serviceLine).join('\n');
  const serviceFields = lineChunks(serviceLines ? serviceLines.split('\n') : []).map((value, index) => ({
    name: index ? 'Service health · continued' : `Service health · ${runningServices}/${tracked.length} running`,
    value,
    inline: false,
  }));
  const mediaLines = media.map(mediaLine).join('\n');
  const checks = [
    `${data.temperature_c == null ? '⚪' : data.temperature_c >= 85 ? '🔴' : data.temperature_c >= 75 ? '🟠' : '🟢'} CPU sensor ${data.temperature_c == null ? 'unavailable' : `${data.temperature_c.toFixed(0)}°C`}`,
    `${data.containers.unhealthy.length ? '🔴' : '🟢'} Container health ${data.containers.unhealthy.length ? 'attention' : 'clear'}`,
    `${(data.storage || []).some((disk) => disk.percent >= 90) ? '🔴' : '🟢'} Storage thresholds ${(data.storage || []).some((disk) => disk.percent >= 90) ? 'attention' : 'clear'}`,
    `${(data.drives || []).some((drive) => drive.critical) ? '🔴' : (data.drives || []).some((drive) => drive.warning) ? '🟠' : data.drives?.length ? '🟢' : '⚪'} SMART drive checks ${data.drives?.length ? 'available' : 'unavailable'}`,
    `${media.some((item) => !item.online) ? '🔴' : media.length ? '🟢' : '⚪'} Media reachability ${media.filter((item) => item.online).length}/${media.length}`,
    ...(mediaSummary?.assessed === true ? [`${mediaSummary.complete ? '🟢' : '🟡'} Media stack ${mediaSummary.complete ? 'complete' : 'incomplete'}${mediaSummary.complete ? '' : ` · missing ${(mediaSummary.missing || []).join(', ')}`}`] : []),
  ];
  const actions = [...result.issues.map((item) => `• ${item}`), ...result.recommendations.map((item) => `• ${item}`)];
  return base(commandTitle(data, 'health diagnostic'), `${result.critical ? '🔴' : result.issues.length ? '🟡' : '🟢'} **${result.label}**\nA focused diagnostic with actionable checks.`, 'Concise host and service health check')
    .setColor(result.color)
    .addFields(
      { name: 'Checks', value: checks.join('\n'), inline: false },
      ...(serviceFields.length ? serviceFields : [{ name: `Service health · ${runningServices}/${tracked.length} running`, value: 'No tracked services returned.', inline: false }]),
      { name: `Media health • ${onlineMedia}/${media.length} online`, value: `${mediaLines || 'No media checks returned.'}${mediaSummary?.assessed === true ? `\n\n${mediaStackStatus(mediaSummary)}` : ''}`, inline: false },
      { name: 'Live host snapshot', value: `${meter('CPU', data.cpu_percent, cpuDetail(data))}\n\n${meter('Memory', memory, `${bytes(data.memory.used)} / ${bytes(data.memory.total)}`)}`, inline: true },
      { name: 'Storage snapshot', value: diskSummary(data), inline: true },
      { name: 'Runtime', value: `**Swap** ${swap}\n**Uptime** ${duration(data.uptime_seconds)}`, inline: true },
      { name: actions.length ? 'What needs attention' : 'What needs attention', value: actions.length ? actions.join('\n').slice(0, 1024) : '✅ Nothing urgent detected in this check.', inline: false },
    );
}

export function reportEmbeds(data, services, media, audit, systemUpdates = null, mediaSummary = null, plex = null) {
  const result = assessment(data, services, media, mediaSummary);
  const memory = memoryPercent(data);
  const swap = data.memory?.swap_total ? `${bytes(data.memory.swap_used)} / ${bytes(data.memory.swap_total)}` : 'Disabled';
  const tracked = services.filter((service) => service.container);
  const serviceLines = tracked.map(serviceLine);
  const serviceFields = lineChunks(serviceLines).map((value, index) => ({
    name: index ? '📦 Services · continued' : `📦 Services (${tracked.length})`,
    value,
    inline: false,
  }));
  const mediaLines = media.map(mediaLine);
  const plexDetected = media.some((item) => item.id === 'plex' || /plex/i.test(String(item.label || '')));
  const runningServices = tracked.filter((service) => service.state === 'running').length;
  const onlineMedia = media.filter((item) => item.online).length;
  const auditLines = (audit || []).slice(-8).reverse().map((event) => `• <t:${Math.floor(new Date(event.timestamp).getTime() / 1000)}:R> ${event.action} ${event.service} — ${event.result}`);
  const overview = base(commandTitle(data, 'detailed health report'), `${result.critical ? '🔴' : result.issues.length ? '🟡' : '🟢'} **${result.label}**\nA full snapshot of the host, storage, drives, services, and media paths.`, 'Full host, storage, service and media report')
    .setColor(result.color)
    .addFields(
      { name: '⚙️ System telemetry', value: `${meter('CPU', data.cpu_percent, cpuDetail(data, true))}\n\n${meter('Memory', memory, `${bytes(data.memory.used)} / ${bytes(data.memory.total)}`)}`, inline: true },
      { name: '⏱️ Runtime', value: `**Docker** ${data.containers.running}/${data.containers.total} running\n**Tracked** ${data.containers.tracked_running}/${data.containers.tracked_total} running\n**Swap** ${swap}\n**Uptime** ${duration(data.uptime_seconds)}\n**Captured** <t:${Math.floor(new Date(data.timestamp).getTime() / 1000)}:R>`, inline: true },
      { name: '🧾 Host specifications', value: `**OS** ${operatingSystemLabel(data)}\n**CPU** ${data.specs?.cpu_model || 'Unknown'}\n**Frequency** ${frequency(data)}\n**Cores** ${data.specs?.logical_cores || '—'} logical • **Architecture** ${data.specs?.architecture || '—'}\n**RAM** ${bytes(data.memory.total)} • **Speed** ${memorySpeed(data)}\n**Kernel** ${data.specs?.kernel || 'Unknown'}\n**Node** ${data.hostname}`, inline: false },
      { name: '💾 Storage', value: diskSummary(data), inline: false },
      { name: '🩺 SMART / drive health', value: driveSummary(data), inline: false },
      ...(systemUpdates ? [{ name: hostUpdateFieldName(systemUpdates, 'update status'), value: hostUpdateSummary(systemUpdates), inline: false }] : []),
      { name: '⚠️ Assessment', value: [...result.issues.map((item) => `• ${item}`), ...result.recommendations.map((item) => `• ${item}`)].join('\n').slice(0, 1024) || '✅ No warnings or recommendations.', inline: false },
    );
  const operations = base(commandTitle(data, 'operations detail'), 'The services and endpoints that make up the home stack.', 'Service and media health detail')
    .setColor(colors.idle)
    .addFields(
      { name: '📡 Live health summary', value: `**Services** ${runningServices}/${tracked.length} running\n**Media** ${onlineMedia}/${media.length} online`, inline: false },
      ...(serviceFields.length ? serviceFields : [{ name: `📦 Services (${tracked.length})`, value: 'No tracked services found.', inline: false }]),
      { name: '🎬 Media endpoints', value: `${mediaLines.join('\n') || 'No media checks returned.'}${mediaSummary?.assessed === true ? `\n\n${mediaStackStatus(mediaSummary)}` : ''}`, inline: false },
      ...((plexDetected || plex?.enabled) ? [{ name: '🎞️ Plex activity', value: plexSessionLines(plex), inline: false }] : []),
      { name: '🧾 Recent control actions', value: auditLines.join('\n') || 'No Discord control actions recorded.', inline: false },
    );
  return [overview, operations];
}

export function storageEmbed(data) {
  const drives = data.drives || [];
  const embed = base('Storage // capacity + drive health', 'Live filesystem usage with Scrutiny SMART checks.', 'Filesystem capacity and SMART health').setColor(drives.some((drive) => drive.critical) ? colors.bad : drives.some((drive) => drive.warning) ? colors.warn : colors.ok);
  for (const disk of data.storage || []) embed.addFields({ name: `💾 ${disk.label} — ${bytes(disk.total)}`, value: `${percentLabel(disk.percent)} used\n${bytes(disk.used)} used • ${bytes(disk.free)} free`, inline: false });
  embed.addFields({
    name: '🩺 SMART drive checks',
    value: driveSummary(data),
    inline: false,
  });
  return embed;
}

export function servicesEmbed(services) {
  const healthy = services.filter((s) => s.state === 'running' && s.health !== 'unhealthy' && s.health !== 'unreachable').length;
  const discovered = services.filter((s) => s.discovered).length;
  const lines = services.map((s) => `${(s.state === 'running' && s.health !== 'unhealthy' && s.health !== 'unreachable') ? '🟢' : '🔴'} **${s.label}** — ${s.state} • ${serviceHealth(s)}`);
  const summary = `**${healthy}/${services.length}** available${discovered ? ` · **${discovered}** auto-detected` : ''}`;
  const listing = lines.join('\n');
  const description = `${summary}\n\n${listing}`.slice(0, 4000);
  return base('Services', description, 'Live Docker catalogue · refresh to detect new containers').setColor(healthy === services.length ? colors.ok : colors.warn);
}

function providerLine(provider) {
  const healthy = provider.online === true;
  const latency = Number.isFinite(Number(provider.latency_ms))
    ? ` · ${safeUpdateText(provider.probe_type || 'TCP connect', 30)} ${Math.round(Number(provider.latency_ms)).toLocaleString('en-GB')} ms`
    : '';
  const detail = provider.detail && provider.detail !== 'endpoint reachable' ? ` · ${provider.detail}` : '';
  return `${healthy ? '🟢' : '🔴'} **${safeUpdateText(provider.label || provider.id || 'Provider', 80)}** · ${healthy ? 'online' : 'unreachable'}${latency}${detail}`;
}

function networkStackStatus(summary) {
  if (!summary || summary.assessed !== true) return '';
  if (summary.complete) {
    const expected = Array.isArray(summary.expected) && summary.expected.length ? ` · ${summary.expected.join(' · ')}` : '';
    return `🟢 **Network stack complete**${expected}`;
  }
  const missing = Array.isArray(summary.missing) && summary.missing.length ? summary.missing.join(' · ') : 'required providers not detected';
  return `🟡 **Network stack incomplete** · missing ${missing}`;
}

export function networkEmbed(providers, summary = null, hostStatus = {}) {
  const rows = Array.isArray(providers) ? providers : [];
  if (!rows.length) {
    const status = networkStackStatus(summary);
    return base(commandTitle(hostStatus, 'network'), `No DNS or network services were detected.${status ? `\n\n${status}` : ''}`, 'Auto-detected providers · TCP timings are endpoint checks · read-only').setColor(summary?.assessed && !summary.complete ? colors.warn : colors.idle);
  }
  const online = rows.filter((provider) => provider.online).length;
  const lines = rows.map(providerLine).join('\n');
  const containers = rows.map((provider) => provider.container).filter(Boolean);
  const completeness = networkStackStatus(summary);
  const description = `${online === rows.length ? '🟢' : '🔴'} **${online}/${rows.length} detected providers online**${completeness ? `\n${completeness}` : ''}\n${lines}`;
  return base(commandTitle(hostStatus, 'network'), description, 'Auto-detected providers · TCP timings are endpoint checks · read-only')
    .setColor(summary?.assessed && !summary.complete ? colors.warn : online === rows.length ? colors.ok : colors.bad)
    .addFields({ name: 'Detected services', value: containers.length ? containers.map((container) => `• ${safeUpdateText(container, 90)}`).join('\n').slice(0, 1024) : 'External provider endpoint', inline: false });
}

export function controlsEmbed(services, policy = {}, options = {}) {
  const source = Array.isArray(policy.services) && policy.services.length ? policy.services : Array.isArray(services) ? services : [];
  const entries = source.filter((service) => service && service.key);
  const enabled = entries.filter((service) => service.enabled ?? service.manageable).length;
  const protectedCount = entries.filter((service) => service.protected).length;
  const mode = policy.mode || config.serviceControlMode || 'opt-out';
  const allowActions = options.allowActions !== false;
  const selectedKey = options.selectedKey || options.key;
  const selected = options.detail
    ? selectedKey ? entries.find((service) => service.key === selectedKey) || null : entries.length === 1 ? entries[0] : null
    : null;
  const pageSize = 75;
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const page = Math.min(pageCount - 1, Math.max(0, Number(options.page) || 0));
  const pageStart = page * pageSize;
  const pageEntries = entries.slice(pageStart, pageStart + pageSize);
  const pageNote = !selected && pageCount > 1
    ? `\nPage **${page + 1}/${pageCount}** · showing ${pageStart + 1}–${Math.min(pageStart + pageSize, entries.length)} of ${entries.length}`
    : '';
  const description = selected
    ? `${selected.protected ? '🛡️' : (selected.enabled ? '🟢' : '⚪')} **${safeUpdateText(selected.label, 100)}**\n${selected.container ? `Container: ${safeUpdateText(selected.container, 140)}\n` : ''}${selected.protected ? 'This container is protected and cannot be controlled remotely.' : selected.enabled ? 'Controls are enabled for this container.' : 'This container is Read-only until an administrator enables it.'}${allowActions ? '' : '\n\n🔒 Guest view · only administrators can change this policy.'}`
    : `${mode === 'opt-in' ? '🛡️' : '⚡'} **${mode === 'opt-in' ? 'Opt-in controls' : 'Opt-out controls (recommended)'}**\n**${enabled}/${entries.length}** detected containers currently controllable${protectedCount ? ` · ${protectedCount} protected` : ''}\n${safeUpdateText(policy.mode_description || (mode === 'opt-out' ? 'New containers are controllable by default. Select a container below to switch its controls off; protected control-plane containers always stay read-only.' : 'New containers are read-only by default. Select a container below to enable its controls one at a time.'), 420)}\n${allowActions ? 'Select a container below to review or change its policy.' : 'Guest view is read-only; only administrators can change policies.'}${pageNote}`;
  const lines = selected ? [] : pageEntries.map((service) => {
    const active = service.enabled ?? service.manageable;
    const icon = service.protected ? '🛡️' : active ? '🟢' : '⚪';
    const state = service.protected ? 'protected' : active ? 'enabled' : 'read-only';
    return `${icon} **${safeUpdateText(service.label || service.key, 80)}** · ${state}`;
  });
  const remaining = entries.length - (pageStart + pageEntries.length);
  if (!selected && remaining > 0) lines.push(`… ${remaining} more · use Next page below`);
  const embed = base(commandTitle({}, 'container controls'), description, allowActions ? 'Administrator policy · explicit confirmation still required' : 'Read-only guest view · administrator policy changes are hidden')
    .setColor(selected?.protected ? colors.idle : selected?.enabled ? colors.ok : colors.warn);
  if (lines.length) embed.addFields({ name: 'Detected containers', value: lines.join('\n').slice(0, 1024), inline: false });
  if (!selected && !entries.length) embed.setDescription(`${mode === 'opt-in' ? '🛡️' : '⚡'} **${mode === 'opt-in' ? 'Opt-in controls' : 'Opt-out controls'}**\nNo containers were detected yet.`);
  return embed;
}

export function controlsRows(services, policy = {}, options = {}) {
  const source = Array.isArray(policy.services) && policy.services.length ? policy.services : Array.isArray(services) ? services : [];
  const entries = source.filter((service) => service && service.key);
  const selectedKey = options.selectedKey || options.key;
  const service = options.detail
    ? selectedKey ? entries.find((item) => item?.key === selectedKey) || null : entries.length === 1 ? entries[0] : null
    : null;
  const pageSize = 75;
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const page = Math.min(pageCount - 1, Math.max(0, Number(options.page) || 0));
  if (service) {
    const backId = page > 0 ? `control:back:${page + 1}` : 'control:back';
    const buttons = [new ButtonBuilder().setCustomId(backId).setLabel('Back to controls').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)];
    if (options.allowActions !== false && !service.protected) {
      const active = service.enabled ?? service.manageable;
      buttons.unshift(new ButtonBuilder().setCustomId(`control-toggle:${service.key}:${active ? 'off' : 'on'}`).setLabel(active ? 'Disable controls' : 'Enable controls').setEmoji(active ? '⏸️' : '✅').setStyle(active ? ButtonStyle.Danger : ButtonStyle.Success));
    }
    return [new ActionRowBuilder().addComponents(buttons)];
  }
  const pageStart = page * pageSize;
  const pageEntries = entries.slice(pageStart, pageStart + pageSize);
  const navigation = [new ButtonBuilder().setCustomId(`controls:refresh:${page + 1}`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary), backButton('panel')];
  if (page > 0) navigation.push(new ButtonBuilder().setCustomId(`controls:page:${page}`).setLabel('Previous').setEmoji('⬅️').setStyle(ButtonStyle.Secondary));
  if (page < pageCount - 1) navigation.push(new ButtonBuilder().setCustomId(`controls:page:${page + 2}`).setLabel('Next').setEmoji('➡️').setStyle(ButtonStyle.Secondary));
  const rows = [new ActionRowBuilder().addComponents(navigation)];
  if (options.allowActions !== false) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('controls:mode')
        .setPlaceholder(`Control mode · ${policy.mode === 'opt-in' ? 'opt-in' : 'opt-out'}`)
        .addOptions([
          { label: 'Opt-out · automatic controls', value: 'opt-out', description: 'Detected containers are enabled unless you switch one off' },
          { label: 'Opt-in · strict review', value: 'opt-in', description: 'Detected containers stay read-only until enabled' },
        ]),
    ));
  }
  const optionsList = pageEntries.map((service) => {
    const active = service.enabled ?? service.manageable;
    return {
      label: safeUpdateText(service.label || service.key, 100),
      value: safeUpdateText(service.key, 100),
      description: `${service.protected ? 'Protected · cannot be changed' : active ? (policy.mode === 'opt-out' && service.override !== false ? 'Enabled by default · select to disable' : 'Controls enabled') : policy.mode === 'opt-out' ? 'Disabled by administrator' : 'Read-only · select to enable'}`.slice(0, 100),
    };
  });
  for (let index = 0; index < optionsList.length; index += 25) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`control:select:${page + 1}:${Math.floor(index / 25) + 1}`)
        .setPlaceholder(optionsList.length > 25 ? `Review containers (${pageStart + index + 1}–${Math.min(pageStart + index + 25, entries.length)})` : 'Review a container policy')
        .addOptions(optionsList.slice(index, index + 25)),
    ));
  }
  return rows.slice(0, 5);
}

function taskText(value, maximum = 100) {
  return String(value || 'Unknown').replace(/[\\`*_~|\r\n@]/g, '').slice(0, maximum);
}

function taskMatches(task, pattern) {
  return pattern.test(`${task?.label || ''} ${task?.name || ''}`);
}

function prioritisedTaskOptions(containers) {
  const priority = containers.filter((task) => task?.role === 'discord-bot' || taskMatches(task, /discord[- ]?bot|homelab[- ]?control[- ]?bot/i));
  const qbit = containers.filter((task) => taskMatches(task, /qbittorrent|qbit/i) && !priority.includes(task));
  const rest = containers.filter((task) => !priority.includes(task) && !qbit.includes(task));
  return [...priority, ...qbit, ...rest];
}

function taskMemoryLine(task) {
  const used = bytes(task.memory_used);
  if (task.memory_limit) {
    const percent = Number.isFinite(Number(task.memory_percent)) ? ` (${Number(task.memory_percent).toFixed(1)}%)` : '';
    return `${used} / ${bytes(task.memory_limit)}${percent}`;
  }
  const percent = Number.isFinite(Number(task.memory_percent)) ? ` (${Number(task.memory_percent).toFixed(1)}% host)` : '';
  return `${used} · no container limit${percent}`;
}

function taskCpuValue(task) {
  const value = Number(task?.cpu_percent);
  return Number.isFinite(value) ? value : null;
}

function taskCpuLabel(task) {
  const value = taskCpuValue(task);
  return value == null ? '—' : `${value.toFixed(1)}%`;
}

function taskSummaryLine(task) {
  return `🟢 **${taskText(task.label || task.name, 80)}** · ${bytes(task.memory_used)} RAM · ${taskCpuLabel(task)} CPU`;
}

function taskGroupStats(tasks) {
  const memory = tasks.reduce((total, task) => total + (Number(task.memory_used) || 0), 0);
  const cpuValues = tasks.map(taskCpuValue).filter((value) => value != null);
  const cpu = cpuValues.length ? `${cpuValues.reduce((total, value) => total + value, 0).toFixed(1)}% CPU sum` : 'CPU —';
  return `${tasks.length} container${tasks.length === 1 ? '' : 's'} · ${bytes(memory)} RAM · ${cpu}`;
}

const taskCategories = [
  { key: 'minecraft', icon: '⛏️', label: 'Minecraft servers', test: /minecraft|spigot|purpur|fabric|forge|folia|velocity|bedrock|bungeecord|waterfall|arclight|sponge|quilt|(?:^|[\s._/-])paper(?:mc)?(?:$|[\s._:-])/i },
  { key: 'media', icon: '🎬', label: 'Media stack', test: /jellyfin|plex|emby|tautulli|seerr|sonarr|radarr|prowlarr|qbittorrent|qbit|jackett|flaresolverr/i },
  { key: 'documents', icon: '📄', label: 'Documents', test: /paperless|tika|gotenberg|broker/i },
  { key: 'home', icon: '🏠', label: 'Home & networking', test: /adguard|home[ -]?assistant|homebridge|syncthing|netboot|pxe|searxng/i },
  { key: 'monitoring', icon: '📈', label: 'Monitoring & research', test: /beszel|scrutiny|uptime[ -]?kuma|archivebox|changedetection|spiderfoot|maigret/i },
  { key: 'control', icon: '🛡️', label: 'Control plane', test: /discord[- ]?bot|control[ -]?agent|homelab[ -]?control/i },
  { key: 'other', icon: '🧩', label: 'Other services', test: /.*/i },
];

function groupedTasks(rows) {
  const groups = new Map(taskCategories.map((category) => [category.key, { ...category, tasks: [] }]));
  for (const task of rows) {
    const category = taskCategories.find((candidate) => candidate.test.test(`${task?.label || ''} ${task?.name || ''}`)) || taskCategories.at(-1);
    groups.get(category.key).tasks.push(task);
  }
  return taskCategories.map((category) => groups.get(category.key)).filter((group) => group.tasks.length);
}

function categoryLines(group) {
  const maximum = group.key === 'other' ? 8 : 12;
  const lines = group.tasks.slice(0, maximum).map(taskSummaryLine);
  const remaining = group.tasks.length - maximum;
  if (remaining > 0) lines.push(`… ${remaining} more · choose a container below for detail`);
  return lines.join('\n').slice(0, 1024) || 'No containers in this category.';
}

function networkSummary(rows) {
  const totals = rows.reduce((result, task) => {
    result.rx += Number(task.network_rx) || 0;
    result.tx += Number(task.network_tx) || 0;
    return result;
  }, { rx: 0, tx: 0 });
  const busiest = rows
    .map((task) => ({ task, total: (Number(task.network_rx) || 0) + (Number(task.network_tx) || 0) }))
    .filter((entry) => entry.total > 0)
    .sort((left, right) => right.total - left.total)
    .slice(0, 4)
    .map(({ task }) => `**${taskText(task.label || task.name, 70)}** · ↓ ${bytes(task.network_rx)} · ↑ ${bytes(task.network_tx)}`);
  return `**↓ ${bytes(totals.rx)} received · ↑ ${bytes(totals.tx)} sent**\n${busiest.join('\n') || 'No network counters returned.'}\nCounters are cumulative since each container started.`.slice(0, 1024);
}

export function tasksEmbed(snapshot, options = {}) {
  const live = options.live === true;
  const tick = Number(options.tick) || 0;
  const ended = options.ended === true;
  const refreshing = options.refreshing === true;
  const refreshTick = Math.max(0, Number(options.refreshTick ?? tick) || 0);
  const refreshElapsedSeconds = Math.max(0, Number(options.refreshElapsedSeconds) || 0);
  const refreshGlyph = loadingGlyphs[refreshTick % loadingGlyphs.length];
  const refreshDots = '.'.repeat((refreshTick % 3) + 1);
  if (!snapshot?.available) {
    return base(
      'Task manager // Docker resources',
      `🔴 **Resource snapshot unavailable**\n${taskText(snapshot?.detail || 'Docker did not return resource statistics.')}`,
      'Read-only view · no container action attempted',
    ).setColor(colors.bad);
  }
  const rawRows = Array.isArray(snapshot.containers) ? snapshot.containers : [];
  const docker = snapshot.docker || {};
  const host = snapshot.host_memory || {};
  const hostPercent = host.total ? (Number(host.used || 0) / Number(host.total)) * 100 : null;
  const failed = Array.isArray(snapshot.failed) ? snapshot.failed : [];
  const discordBot = snapshot.discord_bot || rawRows.find((task) => task.role === 'discord-bot' || /discord[- ]?bot/i.test(String(task.label || '')));
  const rows = [...rawRows];
  if (discordBot && !rows.some((task) => task.id === discordBot.id)) rows.push(discordBot);
  const sampled = docker.sampled ?? rawRows.length;
  const running = docker.running ?? rawRows.length;
  const sampleDuration = Number(snapshot.sample_duration_ms);
  const durationLabel = Number.isFinite(sampleDuration) ? ` · ${(sampleDuration / 1000).toFixed(1)}s` : '';
  const liveLine = live
    ? `\n🟣 **Live window · sample ${tick || 'starting'} · new sample requested every 5s**\nDocker response time is shown above for each sample.`
    : ended ? '\n⚪ **Live window complete · last sample retained · press Live 1 min to start again**' : '';
  const groups = groupedTasks(rows);
  const groupFields = groups.map((group) => ({
    name: `${group.icon} ${group.label} · ${taskGroupStats(group.tasks)}`,
    value: categoryLines(group),
    inline: false,
  }));
  const cpuTotal = Number.isFinite(Number(docker.cpu_percent)) ? `${Number(docker.cpu_percent).toFixed(1)}% CPU sum` : 'CPU not reported';
  const hostValue = `${bytes(host.used)} / ${bytes(host.total)}${hostPercent == null ? '' : ` · ${hostPercent.toFixed(0)}% used`}\nDocker working-set sum · ${bytes(docker.memory_used)}\nContainer CPU sum · ${cpuTotal}`;
  const failedLine = failed.length ? `Stats unavailable for ${failed.length} container${failed.length === 1 ? '' : 's'}: ${failed.map((item) => taskText(item, 80)).join(', ')}` : '';
  const footerNote = refreshing
    ? `${refreshGlyph} Refreshing Docker stats${refreshDots} · last complete sample retained · ${refreshElapsedSeconds.toFixed(0)}s`
    : 'Docker resource snapshot · RAM sum may overlap shared pages/cache · PIDs are in container details';
  const attentionField = failedLine
    ? [{ name: '⚠️ Sampling attention', value: failedLine.slice(0, 1024), inline: false }]
    : [];
  return base(
    'Task manager // Docker resources',
    `📊 **${sampled}/${running} running containers sampled${durationLabel}**\nChecked ${snapshot.checked_at ? `<t:${Math.floor(new Date(snapshot.checked_at).getTime() / 1000)}:R>` : 'just now'}${liveLine}`,
    footerNote,
  )
    .setColor(failed.length ? colors.warn : colors.ok)
    .addFields(
      { name: `🧠 Host · ${bytes(host.total)} RAM`, value: hostValue, inline: false },
      { name: `🌐 Network totals · ${rawRows.length} sampled containers`, value: networkSummary(rawRows), inline: false },
      ...groupFields,
      ...attentionField,
    );
}

export function tasksLoadingEmbed(tick = 0, elapsedSeconds = 0) {
  const tickValue = Math.max(0, Number(tick) || 0);
  const glyph = loadingGlyphs[tickValue % loadingGlyphs.length];
  const dots = '.'.repeat((tickValue % 3) + 1);
  return base('Task manager // refreshing Docker stats', `${glyph} **Sampling the next point${dots}** · ${Math.max(0, Number(elapsedSeconds) || 0).toFixed(0)}s elapsed\n⏳ Waiting for CPU, memory, process-count and network counters\nRead-only refresh · the previous sample will return when this one is complete.`, 'Docker resource snapshot').setColor(colors.idle);
}

export function actionLoadingEmbed(target, action, tick = 0) {
  const tickValue = Math.max(0, Number(tick) || 0);
  const glyph = loadingGlyphs[tickValue % loadingGlyphs.length];
  const dots = '.'.repeat((tickValue % 3) + 1);
  return base(
    `${taskText(target, 90)} // ${taskText(action, 40)}`,
    `${glyph} **Request in flight${dots}**\n⏳ Waiting for the target service to answer`,
    'Confirmed action in progress · no duplicate request queued',
  )
    .setColor(colors.idle);
}

export function taskDetailEmbed(task) {
  const cpu = Number.isFinite(Number(task?.cpu_percent)) ? `${Number(task.cpu_percent).toFixed(1)}% aggregate` : 'Not available in this sample';
  const pids = task?.pids == null ? 'Not reported' : Number(task.pids).toLocaleString('en-GB');
  const network = `↓ ${bytes(task?.network_rx)} received\n↑ ${bytes(task?.network_tx)} sent`;
  return base(
    `Task // ${taskText(task?.label || task?.name || 'Container', 100)}`,
    `🟢 **Running**\n${taskText(task?.name || 'Container', 120)}`,
    'Container resource detail · CPU may need a previous sample',
  )
    .setColor(colors.idle)
    .addFields(
      { name: 'Memory', value: taskMemoryLine(task || {}), inline: true },
      { name: 'CPU & processes', value: `${cpu}\n${pids} processes (PIDs)`, inline: true },
      { name: 'Container image', value: `\`${taskText(task?.image || 'unknown', 240)}\``, inline: false },
      { name: 'Network totals', value: network, inline: true },
    );
}

export function tasksRows(snapshot, live = false) {
  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tasks:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(live ? 'tasks:stop' : 'tasks:live').setLabel(live ? 'Stop live' : 'Live 1 min').setEmoji(live ? '⏹️' : '🟣').setStyle(live ? ButtonStyle.Danger : ButtonStyle.Secondary),
    backButton('panel'),
  )];
  const containers = Array.isArray(snapshot?.containers) ? [...snapshot.containers] : [];
  const discordBot = snapshot?.discord_bot;
  if (discordBot && !containers.some((task) => task.id === discordBot.id)) containers.push(discordBot);
  const prioritised = prioritisedTaskOptions(containers);
  if (!prioritised.length) return rows;
  // One row is reserved for Refresh/Live controls, leaving four selector
  // rows (100 options) within Discord's five-row message limit.
  const options = prioritised.slice(0, 100).map((task) => ({
    label: taskText(task.label || task.name || task.id, 100),
    value: task.id,
    description: `RAM ${taskMemoryLine(task)} · CPU ${Number.isFinite(Number(task.cpu_percent)) ? `${Number(task.cpu_percent).toFixed(1)}%` : '—'}`.slice(0, 100),
  }));
  // Discord permits at most 25 options per select and five component rows per
  // message. Keep larger Docker hosts navigable without emitting invalid
  // component payloads; the embed still reports the complete category totals.
  for (let index = 0; index < options.length; index += 25) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`tasks:select:${Math.floor(index / 25) + 1}`)
        .setPlaceholder(options.length > 25 ? `Inspect containers (${index + 1}–${Math.min(index + 25, options.length)})` : 'Inspect a Docker container')
        .addOptions(options.slice(index, index + 25)),
    ));
  }
  return rows;
}

function cleanSessionText(value, maximum = 180) {
  return String(value || 'Unknown').replace(/[\\`*_~|]/g, '').slice(0, maximum);
}

function activeSessionLines(playback) {
  if (!playback?.enabled) {
    return `⚪ ${playback?.detail || 'Active sessions are not configured'}\nAdd a read-only Jellyfin API key in the app settings.`;
  }
  if (!Array.isArray(playback.sessions) || !playback.sessions.length) {
    return playback.detail ? `⚪ ${playback.detail}` : '✅ No active playback sessions.';
  }
  return playback.sessions.map((session) => {
    const marker = session.state === 'Paused' ? '⏸️' : '▶️';
    const progress = Number.isFinite(Number(session.progress_percent)) ? ` • ${Number(session.progress_percent).toFixed(0)}%` : '';
    const mode = session.play_method ? ` • ${cleanSessionText(session.play_method, 40)}` : '';
    const stream = session.stream_detail ? ` • ${cleanSessionText(session.stream_detail, 100)}` : '';
    return `${marker} **${cleanSessionText(session.title)}**\n└ ${cleanSessionText(session.user, 80)} • ${cleanSessionText(session.device, 80)}${progress}${mode}${stream}`;
  }).join('\n\n').slice(0, 1024);
}

function recentlyAddedLines(playback) {
  if (!playback?.enabled) return '⚪ Recently added is not configured yet.';
  if (!playback.recently_added?.length) return playback.detail ? `⚪ ${playback.detail}` : 'No recently added items returned.';
  return playback.recently_added.map((item) => {
    const icon = item.type === 'Movie' ? '🎬' : item.type === 'Season' || item.type === 'Episode' ? '📺' : '🗂️';
    const seasonNumber = Number(item.season);
    const season = Number.isInteger(seasonNumber) ? ` · S${String(seasonNumber).padStart(2, '0')}` : '';
    const year = item.type === 'Movie' && item.year ? ` · ${item.year}` : '';
    return `${icon} **${cleanSessionText(item.title)}${season}**${year}`;
  }).join('\n').slice(0, 1024);
}

function libraryLines(playback) {
  if (!playback?.enabled) return '⚪ Library statistics are not configured yet.';
  const entries = Object.entries(playback.library || {});
  return entries.length ? entries.map(([label, count]) => `**${label}** ${Number(count).toLocaleString('en-GB')}`).join('  ·  ') : (playback.detail ? `⚪ ${playback.detail}` : 'No library counts returned.');
}

function mediaStorageDisk(hostStatus) {
  const disks = Array.isArray(hostStatus?.storage) ? hostStatus.storage : [];
  return disks.find((disk) => /media|jellyfin/i.test(String(disk?.label || '')));
}

function mediaStorageLines(hostStatus) {
  const disk = mediaStorageDisk(hostStatus);
  if (!disk || !Number.isFinite(Number(disk.total))) return '⚪ Media-volume usage unavailable.';
  return `${bar(disk.percent)}\n${bytes(disk.used)} used · ${bytes(disk.free)} free`;
}

function mediaQuickStatus(items, playback, plex) {
  const online = items.filter((item) => item.online).length;
  const sessions = Array.isArray(playback?.sessions) ? playback.sessions.length : 0;
  const hasJellyfin = items.some((item) => item.id === 'jellyfin' || /jellyfin/i.test(String(item.label || '')));
  const hasPlex = items.some((item) => item.id === 'plex' || /plex/i.test(String(item.label || '')));
  let integration = '';
  if (hasJellyfin) {
    const api = !playback?.enabled ? 'not configured' : playback.detail ? 'attention' : 'healthy';
    integration = `Jellyfin API · ${api}`;
  } else if (hasPlex) {
    const api = !plex?.enabled ? 'token not configured' : plex.detail ? 'attention' : 'healthy';
    integration = `Plex API · ${api}`;
  } else {
    integration = 'Endpoint checks · healthy';
  }
  return `**${online}/${items.length}** endpoints online\n**${sessions}** active session${sessions === 1 ? '' : 's'}\n${integration}`;
}

function mediaStackStatus(summary) {
  if (!summary || summary.assessed !== true) {
    return `⚪ ${summary?.detail || 'Completeness is not configured for this media stack.'}`;
  }
  if (summary.complete) {
    const expected = Array.isArray(summary.expected) && summary.expected.length ? `\nExpected: ${summary.expected.join(' · ')}` : '';
    return `🟢 **Complete**${expected}`;
  }
  const missing = Array.isArray(summary.missing) && summary.missing.length ? summary.missing.join(' · ') : 'required providers not detected';
  return `🟡 **Incomplete**\nMissing: ${missing}`;
}

function mediaResourceLines(resources) {
  if (!resources || resources.available === false) {
    return `⚪ Overall media resource sample unavailable${resources?.detail ? ` · ${cleanSessionText(resources.detail, 180)}` : ''}`;
  }
  const running = Number.isFinite(Number(resources.running)) ? Number(resources.running) : 0;
  const total = Number.isFinite(Number(resources.total)) ? Number(resources.total) : running;
  const memory = Number.isFinite(Number(resources.memory_used)) ? bytes(resources.memory_used) : 'Unknown';
  const cpu = Number.isFinite(Number(resources.cpu_percent)) ? `${Number(resources.cpu_percent).toFixed(1)}%` : '—';
  const failed = Array.isArray(resources.failed) ? resources.failed.length : 0;
  const notRunning = Array.isArray(resources.not_running) ? resources.not_running.length : 0;
  const warnings = failed + notRunning;
  return `**${running}/${total}** containers running · **${memory}** RAM working set\n**${cpu}** CPU sum across media containers${warnings ? `\n⚠️ ${warnings} media container${warnings === 1 ? '' : 's'} not fully sampled` : ''}`;
}

function alertLines(playback) {
  if (!playback?.enabled) return '⚪ Jellyfin alerts are not configured yet.';
  if (!playback.alerts?.length) return playback.detail ? `⚪ ${playback.detail}` : '✅ No recent Jellyfin warnings or errors.';
  return playback.alerts.map((alert) => `${alert.severity === 'Error' ? '🔴' : '🟠'} **${cleanSessionText(alert.name, 120)}**${alert.detail ? `\n└ ${cleanSessionText(alert.detail, 180)}` : ''}`).join('\n\n').slice(0, 1024);
}

function plexSessionLines(plex) {
  if (!plex?.enabled) return `⚪ ${plex?.detail || 'Plex read-only token is not configured.'}`;
  if (!Array.isArray(plex.sessions) || !plex.sessions.length) return plex.detail ? `⚪ ${plex.detail}` : '✅ No active Plex playback sessions.';
  return plex.sessions.map((session) => {
    const progress = Number.isFinite(Number(session.progress_percent)) ? ` · ${Number(session.progress_percent).toFixed(0)}%` : '';
    const mode = session.play_method ? ` · ${cleanSessionText(session.play_method, 40)}` : '';
    const stream = session.stream_detail ? ` · ${cleanSessionText(session.stream_detail, 80)}` : '';
    return `▶️ **${cleanSessionText(session.title)}**\n└ ${cleanSessionText(session.user, 70)} · ${cleanSessionText(session.device, 70)}${progress}${mode}${stream}`;
  }).join('\n\n').slice(0, 1024);
}

function plexLibraryLines(plex) {
  if (!plex?.enabled) return '⚪ Plex libraries are not configured.';
  if (!Array.isArray(plex.libraries) || !plex.libraries.length) return plex.detail ? `⚪ ${plex.detail}` : 'No Plex libraries returned.';
  return plex.libraries.map((library) => `**${cleanSessionText(library.title, 90)}** · ${cleanSessionText(library.type, 40)}`).join('\n').slice(0, 1024);
}

export function mediaEmbed(items, playback = null, hostStatus = null, resources = null, summary = null, plex = null) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    const status = summary?.assessed === true ? `\n${mediaStackStatus(summary)}` : '';
    return base(commandTitle(hostStatus || {}, 'media'), `No compatible media services were detected.${status}`, 'Auto-detected media providers · read-only checks').setColor(summary?.assessed && !summary.complete ? colors.warn : colors.idle);
  }
  const online = rows.filter((item) => item.online).length;
  const providerLines = rows.map(mediaLine).join('\n');
  const fields = [{
    name: '📈 Media stack · overall',
    value: `${mediaStackStatus(summary)}\n\n${mediaResourceLines(resources)}`.slice(0, 1024),
    inline: false,
  }];
  const jellyfinDetected = rows.some((item) => item.id === 'jellyfin' || /jellyfin/i.test(String(item.label || '')));
  const plexDetected = rows.some((item) => item.id === 'plex' || /plex/i.test(String(item.label || '')));
  if (jellyfinDetected || playback?.enabled) {
    fields.push({
      name: `🎬 Active sessions${playback?.enabled && Array.isArray(playback.sessions) ? ` • ${playback.sessions.length}` : ''}`,
      value: activeSessionLines(playback),
      inline: false,
    }, {
      name: '🆕 Recently added',
      value: recentlyAddedLines(playback),
      inline: false,
    }, {
      name: '📚 Jellyfin library',
      value: libraryLines(playback),
      inline: true,
    }, {
      name: '⚠️ Jellyfin alerts',
      value: alertLines(playback),
      inline: true,
    });
  }
  if (plexDetected || plex?.enabled) {
    fields.push({
      name: `🎞️ Plex activity${plex?.enabled && Array.isArray(plex.sessions) ? ` • ${plex.sessions.length}` : ''}`,
      value: plexSessionLines(plex),
      inline: false,
    }, {
      name: '📚 Plex libraries',
      value: plexLibraryLines(plex),
      inline: true,
    });
  }
  fields.push({ name: '📊 Quick status', value: mediaQuickStatus(rows, playback, plex), inline: true }, {
    name: '💾 Media volume',
    value: mediaStorageLines(hostStatus),
    inline: true,
  });
  return base(commandTitle(hostStatus || {}, 'media'), `📊 **${online}/${rows.length} detected providers online**\n${providerLines}`, 'Auto-detected media providers · read-only checks')
    .setColor(summary?.assessed && !summary.complete ? colors.warn : online === rows.length ? colors.ok : colors.bad)
    .addFields(...fields);
}

export function minecraftEmbed(servers) {
  if (!servers.length) return base('Minecraft', 'No supported Minecraft panel or Docker server was detected.', 'Auto-detected Minecraft backends · read-only by default').setColor(colors.idle);
  const online = servers.filter((server) => server.running).length;
  const backends = [...new Set(servers.map((server) => {
    if (server.panel) return server.panel;
    if (server.backend === 'docker') return 'Docker discovery';
    return server.backend;
  }).filter(Boolean))];
  const lines = servers.map((server) => {
    const resources = server.resources || {};
    const resourceParts = [];
    if (Number.isFinite(Number(resources.cpu_percent))) resourceParts.push(`CPU ${Number(resources.cpu_percent).toFixed(1)}%`);
    if (Number.isFinite(Number(resources.memory_used))) resourceParts.push(`RAM ${bytes(resources.memory_used)}`);
    if (Number.isFinite(Number(resources.pids))) resourceParts.push(`PIDs ${Number(resources.pids).toLocaleString('en-GB')}`);
    const resourceLine = resourceParts.length ? `\n└ ${resourceParts.join(' · ')}` : '';
    const status = server.running ? 'Online' : server.state === 'unknown' ? 'Status unknown' : 'Offline';
    const error = server.resource_error ? `\n└ ⚪ ${safeUpdateText(server.resource_error, 120)}` : '';
    return `${server.running ? '🟢' : '⚫'} **${safeUpdateText(server.name || 'Minecraft server', 100)}**\n└ ${safeUpdateText(server.type || 'Minecraft server', 70)} · ${safeUpdateText(server.version || 'Version not reported', 90)} · ${status}${resourceLine}${error}`;
  });
  const backendLine = backends.length ? `\nBackends · ${backends.map((backend) => safeUpdateText(backend, 60)).join(' · ')}` : '';
  return base('Minecraft fleet', `📊 **${online}/${servers.length} online**${backendLine}\n\n${lines.join('\n\n')}`.slice(0, 4096), 'Auto-detected Minecraft backends · resource samples are read-only').setColor(online ? colors.ok : colors.idle);
}

export function panelRows(withBack = false) {
  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('nav:status').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('nav:services').setLabel('Services').setEmoji('🧩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:minecraft').setLabel('Minecraft').setEmoji('⛏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:storage').setLabel('Storage').setEmoji('💾').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:media').setLabel('Media').setEmoji('🎬').setStyle(ButtonStyle.Secondary),
  ), new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('nav:tasks').setLabel('Tasks').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:network').setLabel('Network').setEmoji('🌐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:updates').setLabel('Updates').setEmoji('⬆️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:controls').setLabel('Controls').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
  )];
  if (withBack) rows.push(...backRow('panel'));
  return rows;
}

export function serviceRows(services) {
  const options = services.filter((s) => s.container).map((s) => ({
    label: s.label.slice(0, 100), value: s.key, description: `${s.state} • ${serviceHealth(s)}${s.discovered ? ' • auto-detected' : s.manageable ? ' • manageable' : ' • protected'}`.slice(0, 100),
  }));
  if (!options.length) return backRow('panel');
  // Discord permits at most 25 options per select. Split the live catalogue
  // into additional rows so a larger Docker host remains fully navigable.
  const rows = [...backRow('panel')];
  for (let index = 0; index < options.length; index += 25) {
    const chunk = options.slice(index, index + 25);
    const number = Math.floor(index / 25) + 1;
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`service:select:${number}`)
        .setPlaceholder(options.length > 25 ? `Choose a service (${index + 1}–${Math.min(index + 25, options.length)})` : 'Choose a service')
        .addOptions(chunk),
    ));
  }
  return rows.slice(0, 5);
}

export function minecraftRows(servers) {
  if (!servers.length) return backRow('panel');
  const options = servers.slice(0, 125).map((server) => {
    const resources = server.resources || {};
    const sample = Number.isFinite(Number(resources.cpu_percent)) && Number.isFinite(Number(resources.memory_used))
      ? ` · ${Number(resources.cpu_percent).toFixed(1)}% CPU · ${bytes(resources.memory_used)} RAM`
      : '';
    return {
      label: safeUpdateText(server.name || 'Minecraft server', 100),
      value: server.id,
      description: `${server.running ? 'Online' : 'Offline'}${sample}`.slice(0, 100),
    };
  });
  const rows = [...backRow('panel')];
  for (let index = 0; index < options.length; index += 25) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`mc:select:${Math.floor(index / 25) + 1}`)
        .setPlaceholder(options.length > 25 ? `Choose a Minecraft server (${index + 1}–${Math.min(index + 25, options.length)})` : 'Choose a Minecraft server')
        .addOptions(options.slice(index, index + 25)),
    ));
  }
  return rows.slice(0, 5);
}

export function errorEmbed(message) {
  return base('Request failed', `🔴 ${String(message).slice(0, 1500)}`, 'Control request result').setColor(colors.bad);
}
