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

function containerOsInfo(data = {}) {
  const value = data?.container_os || data?.containerOs || data?.docker_os;
  return value && typeof value === 'object' ? value : {};
}

function knownOs(data = {}) {
  const value = osInfo(data);
  return Boolean(value.id && String(value.id).toLowerCase() !== 'unknown');
}

function knownContainerOs(data = {}) {
  const value = containerOsInfo(data);
  return Boolean(value.id && String(value.id).toLowerCase() !== 'unknown');
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

export function postUpdateNoticeEmbed(notice = {}) {
  const version = safeUpdateText(notice.version || 'the new version', 40);
  const previous = notice.previous ? ` (from **${safeUpdateText(notice.previous, 40)}**)` : '';
  return base(
    `${botName()} // update complete`,
    `🟢 **Back online**\nThe scheduled bot update passed both control health checks and version **${version}** is running${previous}.`,
    'Automatic update · shown once after restart',
  ).setColor(colors.ok);
}

function weeklyPair(used, total) {
  const usedNumber = weeklyNumber(used);
  const totalNumber = weeklyNumber(total);
  if (usedNumber == null || totalNumber == null) return 'not reported';
  const usedLabel = bytes(used);
  const totalLabel = bytes(total);
  const usedMatch = usedLabel.match(/^(.+)\s([^\s]+)$/);
  const totalMatch = totalLabel.match(/^(.+)\s([^\s]+)$/);
  if (usedMatch && totalMatch && usedMatch[2] === totalMatch[2]) {
    return `${usedMatch[1]} / ${totalMatch[1]} ${totalMatch[2]}`;
  }
  return `${usedLabel} / ${totalLabel}`;
}

function weeklyNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function weeklyDateLabel(timestamp) {
  const date = new Date(timestamp || '');
  if (!Number.isFinite(date.getTime())) return 'just now';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timeZone,
      day: 'numeric',
      month: 'numeric',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${Number(parts.day)}/${Number(parts.month)}/${parts.year}, ${parts.hour}:${parts.minute}`;
  } catch {
    return 'just now';
  }
}

function weeklySystemValue(data = {}) {
  const cpuValue = weeklyNumber(data.cpu_percent);
  const loadValue = Array.isArray(data.load) ? weeklyNumber(data.load[0]) : null;
  const temperatureValue = weeklyNumber(data.temperature_c);
  const cpu = cpuValue == null ? 'not reported' : `${cpuValue.toFixed(0)}%`;
  const load = loadValue == null ? '—' : loadValue.toFixed(2);
  const temperature = temperatureValue == null ? '—' : `${temperatureValue.toFixed(0)}°C`;
  const memory = data.memory || {};
  const memoryTotal = weeklyNumber(memory.total);
  const memoryUsed = weeklyNumber(memory.used);
  const memoryPercentValue = memoryTotal != null && memoryTotal > 0 && memoryUsed != null
    ? `${((memoryUsed / memoryTotal) * 100).toFixed(0)}%`
    : '—';
  const swapTotal = weeklyNumber(memory.swap_total);
  const swap = swapTotal != null && swapTotal > 0 ? weeklyPair(memory.swap_used, swapTotal) : 'Disabled';
  return `**CPU** ${cpu} · **load** ${load} · ${temperature}\n**Memory** ${weeklyPair(memory.used, memory.total)} · ${memoryPercentValue}\n**Swap** ${swap}`;
}

function weeklyRuntimeValue(data = {}) {
  const uptime = weeklyNumber(data.uptime_seconds);
  const running = weeklyNumber(data.containers?.running);
  const total = weeklyNumber(data.containers?.total);
  return `**Uptime** ${uptime == null ? 'not reported' : duration(uptime)}\n**Containers** ${running == null || total == null ? 'not reported' : `${running}/${total}`}`;
}

function weeklyStorageValue(data = {}) {
  const disks = Array.isArray(data.storage) ? data.storage.filter((disk) => disk && typeof disk === 'object') : [];
  if (!disks.length) return '⚪ Storage data not reported';
  const lines = disks.slice(0, 6).map((disk) => {
    const total = weeklyNumber(disk.total);
    const used = weeklyNumber(disk.used);
    const reportedPercent = weeklyNumber(disk.percent);
    const percent = reportedPercent != null
      ? reportedPercent
      : total != null && total > 0 && used != null ? (used / total) * 100 : null;
    const meter = percent == null ? '▱▱▱▱▱▱▱▱▱▱ not reported' : bar(percent);
    return `**${safeUpdateText(disk.label || 'Storage', 64)}**\n${meter}\n${weeklyPair(used, total)}`;
  });
  if (disks.length > 6) lines.push(`… ${disks.length - 6} more volumes`);
  return lines.join('\n\n').slice(0, 1024);
}

function weeklyDriveValue(data = {}) {
  const drives = Array.isArray(data.drives) ? data.drives.filter((drive) => drive && typeof drive === 'object') : [];
  if (!drives.length) return '';
  const lines = drives.slice(0, 6).map((drive) => {
    const icon = drive.critical ? '🔴' : drive.warning ? '🟠' : '🟢';
    const driveTemperature = weeklyNumber(drive.temperature_c);
    const temperature = driveTemperature == null ? '' : ` · ${driveTemperature.toFixed(0)}°C`;
    return `${icon} **${safeUpdateText(drive.model || 'Drive', 80)}** · ${safeUpdateText(drive.state || 'status not reported', 80)}${temperature}`;
  });
  if (drives.length > 6) lines.push(`… ${drives.length - 6} more drives`);
  return lines.join('\n\n').slice(0, 1024);
}

function weeklyContainerValue(data = {}, media = [], mediaSummary = null) {
  const containers = data.containers || {};
  const running = weeklyNumber(containers.running);
  const total = weeklyNumber(containers.total);
  const lines = [`${running != null && total != null && running === total ? '🟢' : '🟡'} **${running == null || total == null ? 'Container count unavailable' : `${running}/${total} running`}**`];
  const unhealthy = Array.isArray(containers.unhealthy) ? containers.unhealthy : [];
  if (unhealthy.length) lines.push(`🔴 Unhealthy · ${unhealthy.map((item) => safeUpdateText(item, 60)).join(', ')}`);
  const mediaRows = Array.isArray(media) ? media.filter((item) => item && typeof item === 'object') : [];
  if (mediaRows.length) {
    const online = mediaRows.filter((item) => item.online === true).length;
    const mediaIcon = online === mediaRows.length ? '🟢' : online ? '🟡' : '🔴';
    lines.push(`${mediaIcon} **Media** ${online}/${mediaRows.length} online`);
  }
  if (mediaSummary?.assessed === true) {
    const missing = Array.isArray(mediaSummary.missing) && mediaSummary.missing.length
      ? ` · missing ${mediaSummary.missing.map((item) => safeUpdateText(item, 50)).join(', ')}`
      : '';
    lines.push(`${mediaSummary.complete ? '🟢' : '🟡'} **Media stack** ${mediaSummary.complete ? 'complete' : `incomplete${missing}`}`);
  }
  return lines.join('\n').slice(0, 1024);
}

function weeklyUpdatesValue(runtipi = null, systemUpdates = null) {
  const lines = [];
  const currentSources = [];
  const pendingSources = [];
  if (runtipi?.available === true) {
    const appUpdates = Array.isArray(runtipi.updates) ? runtipi.updates : [];
    if (appUpdates.length) {
      const labels = appUpdates.slice(0, 4).map((item) => updateVersionLine(item)).join('\n');
      const remaining = appUpdates.length > 4 ? ` · +${appUpdates.length - 4} more` : '';
      lines.push(`🟡 **Runtipi apps** · ${appUpdates.length} available${remaining}\n${labels}`);
      pendingSources.push('Runtipi');
    } else {
      const installed = weeklyNumber(runtipi.installed_total);
      currentSources.push(installed != null && installed > 0 ? `Runtipi ${installed} apps` : 'Runtipi apps');
    }
  } else if (runtipi?.available === false && runtipi?.detail) {
    lines.push('⚪ **Runtipi apps** · check unavailable');
  }
  const bot = runtipi?.bot;
  if (bot?.configured) {
    if (bot.available === false) lines.push(`⚪ **${botName()}** · GitHub check unavailable`);
    else if (bot.update_available) {
      lines.push(`🟡 **${botName()}** · ${safeUpdateText(bot.latest || 'update', 48)} available`);
      pendingSources.push(botName());
    } else {
      currentSources.push(`${botName()} ${safeUpdateText(bot.current || 'current', 48)}`);
    }
  }
  if (systemUpdates?.available === true) {
    const os = operatingSystemShortLabel(systemUpdates, 'Host');
    const pending = weeklyNumber(systemUpdates.pending_count);
    const securityCount = weeklyNumber(systemUpdates.security_count);
    if (pending != null && pending > 0) {
      const security = securityCount != null ? ` · ${securityCount} security` : '';
      lines.push(`🟡 **${safeUpdateText(os, 64)}** · ${pending} pending${security}`);
      pendingSources.push(os);
    } else if (pending != null) {
      currentSources.push(`${safeUpdateText(os, 64)} host`);
    } else {
      lines.push(`⚪ **${safeUpdateText(os, 64)}** · update status unavailable`);
    }
  } else if (systemUpdates?.available === false) {
    const os = operatingSystemShortLabel(systemUpdates, 'Host');
    lines.push(`⚪ **${safeUpdateText(os, 64)}** · update check unavailable`);
  }
  if (!lines.length && currentSources.length) {
    lines.push(`🟢 **No pending updates** · ${currentSources.join(' · ')}`);
  } else if (lines.length && !pendingSources.length && currentSources.length) {
    lines.push(`🟢 Current · ${currentSources.join(' · ')}`);
  }
  return lines.join('\n').slice(0, 1024);
}

export function weeklyHealthEmbed(data = {}, services = [], media = [], systemUpdates = null, runtipiUpdates = null, mediaSummary = null) {
  const result = assessment(data, services, media, mediaSummary);
  const footerZone = config.timeZone === 'Asia/Singapore' ? 'SGT' : config.timeZone;
  const statusIcon = result.critical ? '🔴' : result.issues.length ? '🟡' : '🟢';
  const embed = base(
    `${serverName(data)} Weekly Health`,
    `${statusIcon} **${result.label}**`,
    `Internal monitoring · Sundays at 8:00 PM ${footerZone} · ${weeklyDateLabel(data.timestamp)}`,
  ).setColor(result.color).addFields(
    { name: '⚙️ System', value: weeklySystemValue(data), inline: true },
    { name: '⏱️ Runtime', value: weeklyRuntimeValue(data), inline: true },
    { name: '💾 Storage usage', value: weeklyStorageValue(data), inline: true },
  );
  const driveValue = weeklyDriveValue(data);
  const driveCount = Array.isArray(data.drives) ? data.drives.length : 0;
  if (driveValue) embed.addFields({ name: `🩺 Drive health · ${driveCount}`, value: driveValue, inline: false });
  embed.addFields({ name: '📦 Containers', value: weeklyContainerValue(data, media, mediaSummary), inline: false });
  const updates = weeklyUpdatesValue(runtipiUpdates, systemUpdates);
  if (updates) embed.addFields({ name: '⬆️ Updates', value: updates, inline: false });
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
      { name: 'Overview', value: '`/panel` command centre\n`/status` host snapshot\n`/health` concise diagnostic\n`/report` detailed health report\n`/ping` bot + gateway timing', inline: true },
      { name: 'Workloads', value: '`/tasks` live Docker resource view\n`/services` detected containers\n`/media` media providers and playback\n`/minecraft` server status and controls', inline: true },
      { name: 'Operations', value: '`/storage` capacity, SMART and drives\n`/network` detected DNS/network providers\n`/updates` available host, app and bot releases\n`/settings` access, controls and recovery\n`/wake` Wake-on-LAN (saved favourites supported)', inline: true },
      { name: 'Access', value: 'Guests can view read-only commands and use `/wake`. Administrators can confirm service, Minecraft and update actions. Open `/settings` to manage identities, control policy, update stream and recovery options.', inline: false },
    );
}

export function pingEmbed({ processingMs, websocketMs, gatewayMs, gatewayReachable, dnsConfigured, dnsReachable } = {}) {
  const processing = Number.isFinite(Number(processingMs)) ? `${Math.max(0, Math.round(Number(processingMs))).toLocaleString('en-GB')} ms` : 'not measured';
  const gateway = Number.isFinite(Number(websocketMs)) && Number(websocketMs) >= 0
    ? `${Math.round(Number(websocketMs)).toLocaleString('en-GB')} ms`
    : 'not reported';
  const internalGateway = Number.isFinite(Number(gatewayMs)) && Number(gatewayMs) >= 0
    ? `${Math.round(Number(gatewayMs)).toLocaleString('en-GB')} ms`
    : gatewayReachable === false ? 'unreachable' : 'not measured';
  const dns = dnsReachable ? 'answering' : dnsConfigured ? 'configured · no response' : 'not configured';
  return base(
    `${botName()} // ping`,
    `🟢 **Response received**\nBot processing · **${processing}**\nDiscord gateway · **${gateway}**\nInternal gateway · **${internalGateway}**\nDNS · **${dns}**`,
    'Measured when handled · internal gateway and DNS probes are read-only',
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
      { name: `${operatingSystemIcon(data)} Host operating system`, value: operatingSystemLabel(data, 'Host OS unavailable'), inline: false },
      ...(knownContainerOs(data) ? [{ name: '📦 Control container', value: operatingSystemLabel({ os: containerOsInfo(data) }, 'Container OS unavailable'), inline: false }] : []),
      { name: 'Containers', value: `**${data.containers.running}/${data.containers.total}** running${data.containers.unhealthy.length ? `\nUnhealthy: ${data.containers.unhealthy.join(', ')}` : ''}`, inline: false },
    );
}

export function panelEmbed(data, services, media, updates = null, mediaSummary = null) {
  const result = assessment(data, services, media, mediaSummary);
  const memory = memoryPercent(data);
  const onlineMedia = media.filter((item) => item.online).length;
  const trackedRunning = services.filter((item) => item.container && item.state === 'running').length;
  const updateCount = Array.isArray(updates?.updates) ? updates.updates.length : null;
  // A missing update snapshot means the optional Runtipi integration was not
  // queried (or failed before it returned). Do not turn that absence into a
  // misleading “up to date” claim in the compact panel.
  const runtipiState = updates?.available === true
    ? updateCount ? `🟡 ${updateCount} available` : '🟢 Up to date'
    : '';
  const bot = updates?.bot;
  const botState = !bot?.configured ? '' : bot.available === false ? '🟡 Check unavailable' : bot.update_available ? `🟡 ${bot.latest || 'update'} available` : `🟢 ${bot.current || 'current'}`;
  const softwareLines = [];
  // Put the controller first: it is the only component that can report back
  // after replacing itself.  Optional Runtipi status is omitted entirely when
  // that integration is not configured or currently unavailable.
  if (botState) softwareLines.push(`**${bot.channel === 'beta' ? 'Beta' : 'Stable'} bot** ${botState}`);
  if (runtipiState) softwareLines.push(`**Runtipi apps** ${runtipiState}`);
  if (!softwareLines.length) softwareLines.push('No software update sources are configured');
  return base(commandTitle(data, 'control centre'), `${result.critical ? '🔴' : result.issues.length ? '🟡' : '🟢'} **${result.label}**\nYour live command centre for the home server.`, 'Home-server control panel')
    .setColor(result.color)
    .addFields(
      { name: 'Live now', value: `${meter('CPU', data.cpu_percent, cpuDetail(data))}\n\n${meter('Memory', memory, `${bytes(data.memory.used)} / ${bytes(data.memory.total)}`)}\n\n**Uptime** ${duration(data.uptime_seconds)}`, inline: true },
      { name: 'Fleet signal', value: `**Docker** ${data.containers.running}/${data.containers.total}\n**Tracked** ${trackedRunning}/${data.containers.tracked_total}${media.length ? `\n**Media** ${onlineMedia}/${media.length} reachable${mediaSummary?.assessed === true ? `\n${mediaSummary.complete ? '🟢 Complete' : '🟡 Incomplete'}` : ''}` : ''}`, inline: true },
      { name: 'Software', value: `${softwareLines.join('\n')}\nUse \`/updates\` for available, administrator-confirmed actions.`, inline: true },
      { name: `${operatingSystemIcon(data)} Host operating system`, value: operatingSystemLabel(data, 'Host OS unavailable'), inline: true },
      ...(knownContainerOs(data) ? [{ name: '📦 Control container', value: operatingSystemLabel({ os: containerOsInfo(data) }, 'Container OS unavailable'), inline: true }] : []),
      { name: 'Capacity', value: diskSummary(data), inline: false },
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

function safeReleaseNotes(value) {
  const cleaned = String(value || '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/@/g, '@\u200b')
    .replace(/```/g, "'''")
    .trim();
  return cleaned ? cleaned.slice(0, 980) : 'No release notes were published for this version.';
}

function releaseSizeBytes(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function releaseSizeLabel(value) {
  const number = releaseSizeBytes(value);
  if (number === null) return 'size unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = number;
  let unit = 0;
  while (amount >= 1000 && unit < units.length - 1) {
    amount /= 1000;
    unit += 1;
  }
  const rounded = unit === 0 || amount >= 100
    ? Math.round(amount)
    : Math.round(amount * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${units[unit]}`;
}

export function botUpdateConfirmationEmbed(release) {
  const version = safeUpdateText(release?.latest || 'selected release', 60);
  const size = releaseSizeBytes(release?.asset_size) !== null ? `\nSource archive size · **${releaseSizeLabel(release.asset_size)}**` : '';
  return base(
    'Confirm Homelab Control update',
    `Install the verified GitHub release **${version}**?${size}\n\nOnly the control agent and Discord bot images will be rebuilt. Other containers and their data remain online. The previous control images are retained if runtime verification fails.`,
    'Manual administrator confirmation · automatic updates are off by default',
  ).setColor(colors.warn).addFields({ name: `What changed in ${version}`, value: safeReleaseNotes(release?.release_notes), inline: false });
}

function rollbackVersion(value) {
  const cleaned = safeUpdateText(value, 32).replace(/^v/i, '').toLowerCase();
  return cleaned && cleaned !== 'unknown' ? cleaned : '';
}

function rollbackButtonLabel(version) {
  const cleanVersion = rollbackVersion(version);
  if (!cleanVersion) return 'Rollback version';
  return `Rollback to v${cleanVersion}`;
}

function rollbackOptionsFor(release) {
  const raw = Array.isArray(release?.rollback_options)
    ? release.rollback_options
    : Array.isArray(release?.github_rollback_options) ? release.github_rollback_options : [];
  const seen = new Set();
  return raw.filter((option) => {
    const version = rollbackVersion(option?.version);
    if (!version || seen.has(version)) return false;
    seen.add(version);
    return true;
  }).map((option) => ({ ...option, version: rollbackVersion(option.version) })).slice(0, 25);
}

function recommendedRollbackOptions(release) {
  if (Array.isArray(release?.rollback_quick_options) && release.rollback_quick_options.length) {
    return release.rollback_quick_options.slice(0, 6);
  }
  const options = rollbackOptionsFor(release);
  const selected = [];
  const lines = new Set();
  // Prefer the newest verified release from each 0.x minor line, then fill
  // the remaining slots with the next newest versions. This keeps the
  // buttons useful without hiding the complete GitHub history in the menu.
  for (const option of options) {
    const match = option.version.match(/^(\d+)\.(\d+)\./);
    const line = match ? `${match[1]}.${match[2]}` : option.version;
    if (lines.has(line)) continue;
    lines.add(line);
    selected.push(option);
    if (selected.length >= 4) break;
  }
  for (const option of options) {
    if (selected.length >= 4) break;
    if (!selected.some((item) => item.version === option.version)) selected.push(option);
  }
  return selected;
}

function rollbackOptionDescription(option) {
  const published = String(option?.published_at || '').slice(0, 10);
  const size = releaseSizeBytes(option?.asset_size) !== null ? ` · ${releaseSizeLabel(option.asset_size)}` : '';
  return `Verified GitHub archive${size}${/^\d{4}-\d{2}-\d{2}$/.test(published) ? ` · ${published}` : ''}`.slice(0, 100);
}

export function botRollbackOptionsEmbed(release) {
  const options = rollbackOptionsFor(release);
  const localVersion = rollbackVersion(release?.rollback_version);
  const recommended = recommendedRollbackOptions(release);
  const current = rollbackVersion(release?.current) || 'unknown';
  const history = options.length
    ? `**${options.length}** verified GitHub version${options.length === 1 ? '' : 's'} are available below.`
    : 'No verified GitHub archive is currently available.';
  const local = release?.rollback_available && localVersion
    ? `A retained local image pair is also available at **v${localVersion}**.`
    : release?.rollback_available
      ? 'A retained local rollback is available, but its version is not labelled.'
      : 'No retained local image pair is available.';
  const embed = base(
    'Homelab Control // rollback options',
    `Current version · **v${safeUpdateText(current, 40)}** · ${release?.channel === 'beta' ? 'Beta stream' : 'Stable stream'}\n\nChoose a previous version to review before anything changes. ${history} ${local}\n\nThe quick choices use the cloud-published golden, LTS and previous-line approvals when they are available. The full menu is for exact older releases.\n\n⚠️ **Reverting to much older releases is not recommended.** Older builds may be incompatible with the current configuration, APIs or stored data. Prefer the newest verified option unless you have a specific reason to go further back.`,
    'Manual administrator action · exact GitHub archive and SHA-256 digest are checked',
  ).setColor(colors.warn);
  if (recommended.length) {
    embed.addFields({
      name: 'Recommended previous releases',
      value: recommended.map((option) => `• **v${safeUpdateText(option.version, 40)}** · ${releaseSizeBytes(option.asset_size) !== null ? releaseSizeLabel(option.asset_size) : 'size unavailable'} · newest verified option in its release line`).join('\n').slice(0, 1024),
      inline: false,
    });
  }
  if (release?.github_rollback_detail && !options.length) {
    embed.addFields({ name: 'GitHub history', value: safeUpdateText(release.github_rollback_detail, 300), inline: false });
  }
  return embed;
}

export function botRollbackOptionsRows(release) {
  const options = rollbackOptionsFor(release);
  const recommended = recommendedRollbackOptions(release);
  const localVersion = rollbackVersion(release?.rollback_version);
  const buttons = [...recommended];
  if (release?.rollback_available && release?.rollback_source === 'local') {
    // Keep the retained-image action separate from the GitHub version with
    // the same number. The worker can then honour the user's choice instead
    // of silently replacing a local restore with a download.
    buttons.push({ version: localVersion, local: true });
  }
  const rows = backRow('updates', 'Back to updates');
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5).map((option) => (
      new ButtonBuilder()
        .setCustomId(option.local ? 'updates:bot-rollback-retained' : `updates:bot-rollback-version:${safeUpdateText(option.version, 32)}`)
        .setLabel(option.local ? (localVersion ? `Rollback to retained v${localVersion}` : 'Rollback to retained version') : option.quick_role === 'golden' ? `Golden v${option.version}` : option.quick_role === 'lts' ? `LTS v${option.version}` : option.quick_role === 'last_major' ? `Previous line v${option.version}` : rollbackButtonLabel(option.version))
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary)
    ))));
  }
  if (options.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('updates:bot-rollback-select')
        .setPlaceholder('Select a previous version')
        .addOptions(options.map((option) => ({
          label: `v${safeUpdateText(option.version, 80)}`.slice(0, 100),
          value: safeUpdateText(option.version, 80),
          description: rollbackOptionDescription(option),
        }))),
    ));
  }
  return rows;
}

export function botRollbackConfirmationEmbed(release, selection = {}) {
  const version = rollbackVersion(selection?.version || release?.rollback_version);
  const target = version ? `v${version}` : (selection?.local ? 'retained previous release' : 'selected release');
  const source = selection?.local
    ? 'The bridge will use the retained local control images when available.'
    : 'The bridge will fetch this exact GitHub release, verify its SHA-256 digest, and build only the control agent and bot.';
  const size = releaseSizeBytes(selection?.asset_size) !== null ? ` Source archive size · **${releaseSizeLabel(selection.asset_size)}**.` : '';
  return base(
    'Confirm Homelab Control rollback',
    `Roll back to **${safeUpdateText(target, 50)}**?${size}\n\n${source}\n\n⚠️ Reverting to much older releases is not recommended because configuration, APIs or stored data may no longer be compatible. Only the control containers will be changed, and both health checks must pass before completion is reported.`,
    'Manual administrator confirmation · no other containers are changed',
  ).setColor(colors.warn);
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
  const options = rollbackOptionsFor(release);
  if (!release?.rollback_available && !options.length) return null;
  const source = release.rollback_source === 'github'
    ? 'from GitHub'
    : options.length
      ? 'retained locally · GitHub history ready'
      : 'retained locally';
  const newest = options[0]?.version || rollbackVersion(release.rollback_version) || 'previous version';
  return `↩️ Rollback options · newest **v${safeUpdateText(newest, 40)}** · ${source}`;
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
  if (release.channel === 'beta') {
    lines.push('⚠️ Beta live-patch route · automatic updates require explicit acknowledgement in /settings');
  }
  if (releaseSizeBytes(release.asset_size) !== null) lines.push(`Source archive · **${releaseSizeLabel(release.asset_size)}**`);
  if (release.update_available && !release.asset_verified) lines.push('🔒 Update held · the release archive has no verified SHA-256 digest');
  else if (release.update_available && !release.update_supported) lines.push('🔒 Update held · the guarded host release bridge is not configured');
  else if (release.update_available && !active) lines.push('✅ Verified archive ready to install');
  const rollbackLine = botRollbackLine(release);
  if (rollbackLine) lines.push(rollbackLine);
  else if (release.github_rollback_detail) {
    lines.push(`↩️ GitHub rollback options unavailable · ${safeUpdateText(release.github_rollback_detail, 220)}`);
  }
  if (release.detail && !/latest stable release|newer verified release is ready/i.test(String(release.detail))) {
    lines.push(safeUpdateText(release.detail, 280));
  }
  return lines.join('\n').slice(0, 1024);
}

export function hostUpdateSummary(snapshot) {
  const osLabel = operatingSystemLabel(snapshot, 'Host OS unavailable');
  const osShort = operatingSystemShortLabel(snapshot, 'Host');
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
  const isUbuntu = String(osInfo(snapshot).id || '').toLowerCase() === 'ubuntu' || /ubuntu/i.test(osLabel);
  const esmNotice = isUbuntu && /expanded security maintenance for applications|esm apps/i.test(String(snapshot.notice || ''));
  const statusIcon = ['checking', 'applying', 'rebooting'].includes(snapshot.phase) ? '🟣' : snapshot.phase === 'failed' ? '🔴' : snapshot.pending_count > 0 ? '🟡' : '🟢';
  const lines = [
    `🖥️ **Host OS** · ${safeUpdateText(osLabel, 120)}`,
    `${statusIcon} **${pending} pending**`,
    `**Security** · ${security}`,
    `**Phase** · ${phaseLabel}${snapshot.reboot_required ? ' · **restart required**' : ''}`,
  ];
  if (knownContainerOs(snapshot)) {
    const containerLabel = operatingSystemLabel({ os: containerOsInfo(snapshot) }, 'Container OS unavailable');
    lines.push(`📦 **Control container** · ${safeUpdateText(containerLabel, 120)}`);
  }
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
  const detected = knownOs(snapshot);
  const label = detected ? operatingSystemShortLabel(snapshot, 'Host') : 'Host';
  // Do not render the fallback as “Host host”. Keep the field useful even
  // when the host os-release mount is unavailable, while preserving the
  // detected OS name whenever it is known.
  const suffixText = String(suffix || '').trim();
  const finalLabel = !detected && suffixText.toLowerCase() === 'host'
    ? 'Host updates'
    : `${label}${suffixText ? ` ${suffixText}` : ''}`;
  return `${detected ? operatingSystemIcon(snapshot) : '🖥️'} ${finalLabel}`.slice(0, 256);
}

export function updatesEmbed(snapshot, systemUpdates = null) {
  const runtipiAvailable = snapshot?.available === true;
  const botRelease = snapshot?.bot;
  const fields = [];
  if (botRelease) fields.push({ name: `🤖 ${botName()} release`, value: botReleaseSummary(botRelease), inline: false });
  if (systemUpdates) fields.push({ name: hostUpdateFieldName(systemUpdates), value: hostUpdateSummary(systemUpdates), inline: false });
  if (!runtipiAvailable) {
    const unavailable = base(
      'Software updates',
      `${botRelease || systemUpdates ? '🟡 Some update sources are unavailable' : '🟡 Update checks unavailable'}\n${safeUpdateText(snapshot?.detail || 'Runtipi is not connected on this host; available sources are shown below.')}`,
      'No action was attempted · refresh after restoring an unavailable source',
    ).setColor(colors.warn);
    return unavailable.addFields(...fields);
  }
  const updates = Array.isArray(snapshot.updates) ? snapshot.updates : [];
  const protectedUpdates = Array.isArray(snapshot.protected_updates) ? snapshot.protected_updates : [];
  const lines = updates.map(updateVersionLine).join('\n').slice(0, 1024) || '✅ All eligible apps are up to date.';
  const protectedLine = protectedUpdates.length
    ? `${protectedUpdates.map(updateVersionLine).join('\n').slice(0, 700)}\n\nThe controller stays protected so it remains available while other apps update.`
    : 'The controller is protected from update-all actions.';
  const embed = base(
    'Software updates',
    `${updates.length ? '🟡' : '🟢'} **${updates.length ? `${updates.length} update${updates.length === 1 ? '' : 's'} available` : 'All eligible apps are current'}**\nChecked ${snapshot.checked_at ? `<t:${Math.floor(new Date(snapshot.checked_at).getTime() / 1000)}:R>` : 'just now'}`,
    'Runtipi lifecycle · explicit administrator confirmation required',
  )
    .setColor(updates.length ? colors.warn : colors.ok)
    .addFields(
      ...fields,
      { name: `Runtipi updates · ${updates.length}`, value: lines, inline: false },
      { name: 'Protected scope', value: protectedLine, inline: false },
    );
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
  const rollbackOptions = rollbackOptionsFor(botRelease);
  if (allowActions && (botRelease?.rollback_available || rollbackOptions.length) && botRelease.update_supported) {
    botActions.push(new ButtonBuilder().setCustomId('updates:bot-rollback-options').setLabel('Rollback options').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
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

function identityList(values, fallback = 'none configured') {
  const entries = Array.isArray(values) ? values.filter(Boolean).slice(0, 12) : [];
  return entries.length ? entries.map((value) => '`' + safeUpdateText(value, 25) + '`').join(', ') : fallback;
}

export function settingsEmbed(settings = {}, status = {}, policy = null, category = 'home') {
  const mode = settings.autoUpdateMode || 'off';
  const modeLabel = mode === 'off' ? 'off' : mode === 'hotfix' ? 'hotfixes daily (recommended)' : `${mode} at ${String(settings.autoUpdateHour ?? 4).padStart(2, '0')}:00 local time`;
  const betaSelected = settings.releaseChannel === 'beta';
  const betaConfirmed = settings.betaAutoUpdateConfirmed === true;
  const displayedModeLabel = betaSelected && !betaConfirmed && mode !== 'off'
    ? `locked until beta acknowledgement (configured: ${modeLabel})`
    : modeLabel;
  const stream = betaSelected ? 'Beta stream (stable + pre-releases)' : 'Stable stream';
  const host = operatingSystemLabel(status, 'Host OS unavailable');
  const server = serverName(status);
  const superuserIds = [...new Set([config.ownerId, ...(settings.superuserIds || [])])];
  const embed = base(
    category === 'home' ? `${botName()} // settings` : `${botName()} // settings · ${category}`,
    category === 'home'
      ? 'Keep the deployment calm and explicit. Choose a category below; changes are stored in the bot data volume and never expose tokens.'
      : category === 'access'
        ? 'Manage who can use the private panel. The configured owner always remains a superuser.'
        : category === 'updates'
          ? 'Choose the release stream and whether the bot may update itself on a schedule. Off is the default.'
          : category === 'controls'
            ? 'Controls are detected from Docker. Opt-out enables them by default; protected control-plane containers remain read-only.'
            : category === 'recovery'
              ? 'Recovery actions are administrator-only. Host package updates use the detected operating system; reset clears the configured settings files after making a private backup, and restore is available if you change your mind.'
              : 'Connection and identity details for this deployment.',
    'Private administrator settings · secrets are never shown',
  ).setColor(colors.idle);
  if (category === 'home') {
    embed.addFields(
      { name: 'Update behaviour', value: `**Stream** ${stream}\n**Auto-update** ${displayedModeLabel}`, inline: true },
      { name: 'Connection', value: `**Host** ${safeUpdateText(host, 120)}\n**Server** ${safeUpdateText(server, 80)}\n**Containers** ${status.containers ? `${status.containers.running}/${status.containers.total} running` : 'not reported'}`, inline: true },
      { name: 'Access', value: `**Admins** ${identityList(settings.adminUserIds)}\n**Guests** ${identityList(settings.guestUserIds)}\n**Superusers** ${identityList(superuserIds)}`, inline: false },
    );
  } else if (category === 'access') {
    embed.addFields(
      { name: 'Superusers', value: `${identityList(superuserIds)}\nThey can manage administrators and settings. The owner cannot be removed.`, inline: false },
      { name: 'Administrators', value: `${identityList(settings.adminUserIds)}\nAdmins can confirm service, host and release actions.`, inline: false },
      { name: 'Guests', value: `${identityList(settings.guestUserIds)}\nGuests receive read-only views and Wake-on-LAN only.`, inline: false },
    );
  } else if (category === 'updates') {
    embed.addFields(
      { name: 'Release stream', value: `**${stream}**\nBeta is opt-in and receives stable releases plus GitHub pre-releases.`, inline: true },
      { name: 'Automatic checks', value: `**${displayedModeLabel}**\nWeekly checks are for stable major releases; hotfixes are checked daily. Nothing changes when this is off.`, inline: true },
    );
    if (betaSelected) {
      embed.addFields({
        name: betaConfirmed ? '✅ Beta live-patch route acknowledged' : '⚠️ Beta live-patch route requires acknowledgement',
        value: betaConfirmed
          ? 'Automatic updates are allowed only after this explicit acknowledgement. Choose a schedule above when you are ready; you can revoke it at any time.'
          : 'Beta builds can change quickly and may contain pre-release changes. Automatic updates are locked until an administrator acknowledges this live-patch route below. Selecting Beta alone never enables unattended updates.',
        inline: false,
      });
    }
  } else if (category === 'controls') {
    const services = Array.isArray(policy?.services) ? policy.services : [];
    const enabled = services.filter((service) => service.enabled ?? service.manageable).length;
    embed.addFields({ name: 'Current policy', value: `**${policy?.mode || settings.serviceControlMode || 'opt-out'}** · ${enabled}/${services.length} detected containers controllable\n${safeUpdateText(policy?.mode_description || 'Choose a container below to review its lifecycle controls.', 600)}`, inline: false });
  } else if (category === 'recovery') {
    embed.addFields({ name: 'Safety boundary', value: 'Restart and reinstall actions touch only the control agent and Discord bot. Host package updates use the guarded bridge for the detected operating system. Reset clears the configured config/runtime files only after a timestamped private backup; restore that backup before restarting if the config file also supplies Compose values.', inline: false });
  } else {
    embed.addFields(
      { name: 'Host', value: `**${safeUpdateText(host, 120)}**\n${status.hostname ? `Hostname · ${safeUpdateText(status.hostname, 80)}` : ''}`, inline: true },
      { name: 'Discord pairing', value: `**Server** ${safeUpdateText(server, 80)}\n**Guilds** ${config.guildIds.length}`, inline: true },
      { name: 'Runtime', value: `**Bot** ${safeUpdateText(botName(), 80)}\n**Control mode** ${settings.serviceControlMode || config.serviceControlMode}`, inline: true },
    );
  }
  return embed;
}

export function settingsRows(settings = {}, category = 'home', policy = null, page = 0) {
  const scheduleHour = String(settings.autoUpdateHour ?? 4).padStart(2, '0');
  const autoModePlaceholder = settings.releaseChannel === 'beta' && settings.betaAutoUpdateConfirmed !== true && settings.autoUpdateMode && settings.autoUpdateMode !== 'off'
    ? 'Automatic updates · locked'
    : `Automatic updates · ${settings.autoUpdateMode || 'off'}`;
  const home = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('settings:category:access').setLabel('Access').setEmoji('👥').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('settings:category:updates').setLabel('Updates').setEmoji('⬆️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('settings:category:controls').setLabel('Controls').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('settings:category:recovery').setLabel('Recovery').setEmoji('🧰').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('settings:category:status').setLabel('Connection').setEmoji('🖥️').setStyle(ButtonStyle.Secondary),
    ),
  ];
  if (category === 'home') return [...home, ...backRow('panel')];
  const rows = [...home];
  if (category === 'access') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('settings:add:adminUserIds').setLabel('Add admin').setEmoji('➕').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('settings:add:guestUserIds').setLabel('Add guest').setEmoji('➕').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('settings:add:superuserIds').setLabel('Add superuser').setEmoji('⭐').setStyle(ButtonStyle.Secondary),
    ));
    const removable = [
      ...(settings.superuserIds || []).map((id) => ({ id, kind: 'superuserIds', label: 'Superuser' })),
      ...(settings.adminUserIds || []).map((id) => ({ id, kind: 'adminUserIds', label: 'Administrator' })),
      ...(settings.guestUserIds || []).map((id) => ({ id, kind: 'guestUserIds', label: 'Guest' })),
    ].filter((entry) => !(entry.kind === 'superuserIds' && entry.id === config.ownerId))
      .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index).slice(0, 25);
    if (removable.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('settings:remove').setPlaceholder('Remove an identity').addOptions(removable.map((entry) => ({ label: entry.id, value: entry.id, description: entry.label })))));
  } else if (category === 'updates') {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('settings:auto-mode').setPlaceholder(autoModePlaceholder).addOptions([
      { label: 'Off · manual updates', value: 'off', description: 'Recommended when you want full control' },
      { label: 'Hotfixes daily · recommended', value: 'hotfix', description: `Check every day at ${scheduleHour}:00 for compact letter hotfixes` },
      { label: 'Daily stable checks', value: 'daily', description: `Check every day at ${scheduleHour}:00 for stable releases` },
      { label: 'Weekly stable checks', value: 'weekly', description: `Check Sundays at ${scheduleHour}:00 for stable major releases` },
    ])));
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('settings:release-channel').setPlaceholder(`Release stream · ${settings.releaseChannel || 'stable'}`).addOptions([
      { label: 'Stable stream', value: 'stable', description: 'Published stable releases only' },
      { label: 'Beta stream (opt-in)', value: 'beta', description: 'Includes stable releases and GitHub pre-releases' },
    ])));
    if (settings.releaseChannel === 'beta') {
      rows.push(new ActionRowBuilder().addComponents(
        settings.betaAutoUpdateConfirmed === true
          ? new ButtonBuilder().setCustomId('settings:beta-revoke').setLabel('Revoke beta auto-updates').setEmoji('🛑').setStyle(ButtonStyle.Danger)
          : new ButtonBuilder().setCustomId('settings:beta-acknowledge').setLabel('Acknowledge live-patch route').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
      ));
    }
  } else if (category === 'recovery') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('settings:restart').setLabel('Restart bot').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('settings:linux-updates').setLabel('Host updates').setEmoji('🖥️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('settings:reset').setLabel('Reset settings').setEmoji('🧹').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('settings:restore').setLabel('Restore backup').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('settings:fix-preserve').setLabel('Reinstall · keep config').setEmoji('🧰').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('settings:fix-fresh').setLabel('Fresh reinstall').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
    ));
  } else if (category === 'controls') {
    // The controls catalogue already needs all five Discord component rows
    // (refresh/back, mode and up to three selector pages). Keep it intact and
    // use its Back to settings button for category navigation.
    const services = Array.isArray(policy?.services) ? policy.services : [];
    return controlsRows(services, policy || {}, { allowActions: true, page, backTarget: 'settings', backLabel: 'Back to settings', modeCustomId: 'settings:control-mode', selectPrefix: 'settings-control:select', togglePrefix: 'settings-control-toggle', refreshPrefix: 'settings-controls:refresh', pagePrefix: 'settings-controls:page' });
  }
  rows.push(...backRow('settings'));
  return rows.slice(0, 5);
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
  const osLabel = operatingSystemShortLabel(snapshot, 'Host');
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
  const osLabel = operatingSystemShortLabel(snapshot, 'Host');
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

export function hostRestartWaitingEmbed(snapshot = {}) {
  const osLabel = operatingSystemShortLabel(snapshot, 'Host');
  const phase = safeUpdateText(String(snapshot.phase || 'rebooting').replace(/_/g, ' '), 40);
  return base(
    `${osLabel} // restarting`,
    `🟣 **Restarting the host…**\nThe confirmed restart is in progress. The bot will keep checking quietly and replace this message with **Restarted successfully** after the host bridge reports a new boot.\n\n⏳ A short period of silence is expected while the server comes back online.`,
    `${osLabel} restart · waiting for post-boot verification`,
  ).setColor(colors.idle).addFields({ name: 'Current phase', value: phase, inline: false });
}

export function hostRestartResultEmbed(snapshot = {}) {
  const phase = String(snapshot.phase || 'failed').toLowerCase();
  const complete = phase === 'online';
  const osLabel = operatingSystemShortLabel(snapshot, 'Host');
  const icon = complete ? '🟢' : '🔴';
  const headline = complete ? 'Restarted successfully' : 'Restart verification failed';
  const lines = [
    `${icon} **${headline}**`,
    complete ? `${osLabel} is back online after the confirmed restart.` : safeUpdateText(snapshot.detail || 'The host did not report a verified post-boot state.', 320),
  ];
  if (snapshot.online_at) lines.push(`Back online · <t:${Math.floor(new Date(snapshot.online_at).getTime() / 1000)}:R>`);
  if (snapshot.boot_id) lines.push(`Boot identity · **${safeUpdateText(snapshot.boot_id, 80)}**`);
  return base(
    `${osLabel} // restart result`,
    lines.join('\n'),
    `${osLabel} restart · post-boot status ${complete ? 'verified' : 'not verified'}`,
  ).setColor(complete ? colors.ok : colors.bad).addFields({ name: 'Recent activity', value: maintenanceEventLines(snapshot), inline: false });
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
    'Manual release workflow · no other containers are changed',
  ).setColor(colors.idle).addFields({ name: 'Live feed', value: events.slice(0, 1024), inline: false });
}

export function botReleaseRestartEmbed(action, release) {
  const target = release?.latest || release?.requested_version || release?.rollback_version || release?.version || 'selected release';
  const verb = action === 'rollback' ? 'reverting to' : 'updating to';
  return base(
    'Homelab Control // restarting',
    `🟣 **Restarting the control agent and Discord bot…**\nThe controller is ${verb} **${safeUpdateText(target, 60)}**. A short period of silence is expected while it replaces itself.\n\n⏳ This can take several minutes. This message will change to **Update complete** only after the new agent and bot both answer their health checks.`,
    'Manual release hand-off · other containers remain online',
  ).setColor(colors.idle);
}

const maintenanceActionLabels = {
  restart: { title: 'Restarting Homelab Control', verb: 'restarting the control containers', complete: 'Bot restart verified' },
  reset: { title: 'Resetting Homelab Control settings', verb: 'clearing the configured settings after a private backup', complete: 'Settings reset complete' },
  restore: { title: 'Restoring Homelab Control settings', verb: 'restoring the most recent private settings backup', complete: 'Settings restore complete' },
  'fix-preserve': { title: 'Repairing Homelab Control', verb: 'recreating the control containers while preserving configuration', complete: 'Bot repair verified' },
  'fix-fresh': { title: 'Reinstalling Homelab Control', verb: 'recreating the control containers with fresh settings', complete: 'Fresh reinstall verified' },
};

function maintenanceActionLabel(action) {
  return maintenanceActionLabels[action] || { title: 'Maintaining Homelab Control', verb: 'running the confirmed maintenance action', complete: 'Maintenance complete' };
}

export function botMaintenanceLoadingEmbed(action, release, tick = 0) {
  const tickValue = Math.max(0, Number(tick) || 0);
  const glyph = loadingGlyphs[tickValue % loadingGlyphs.length];
  const dots = '.'.repeat((tickValue % 3) + 1);
  const phase = String(release?.phase || 'queued').toLowerCase();
  const stage = botReleaseStages[phase] || `Host bridge phase: ${phase.replace(/_/g, ' ')}`;
  const labels = maintenanceActionLabel(action);
  const events = Array.isArray(release?.events) && release.events.length
    ? release.events.slice(-5).map((event) => `• ${safeUpdateText(event.message, 180)}`).join('\n')
    : 'Waiting for the host bridge to report its first step…';
  return base(
    `${botName()} // ${labels.title}`,
    `${glyph} **${safeUpdateText(stage, 180)}${dots}**\n⏳ The guarded bridge is ${safeUpdateText(labels.verb, 180)}. Completion will be reported only after the resulting control state is read back.`,
    'Manual administrator maintenance · no other containers are changed',
  ).setColor(colors.idle).addFields({ name: 'Live feed', value: events.slice(0, 1024), inline: false });
}

export function botMaintenanceRestartEmbed(action, release = {}) {
  const labels = maintenanceActionLabel(action);
  return base(
    `${botName()} // maintenance hand-off`,
    `🟣 **${safeUpdateText(labels.title, 120)}…**\nThe controller is ${safeUpdateText(labels.verb, 180)}. A short period of silence is expected while the control containers are recreated.\n\n⏳ This can take several minutes. This message will change to **${safeUpdateText(labels.complete, 80)}** after the new control state is verified.`,
    'Manual maintenance hand-off · other containers remain online',
  ).setColor(colors.idle);
}

export function botMaintenanceResultEmbed(action, release = {}) {
  const phase = String(release?.phase || 'failed').toLowerCase();
  const complete = phase === 'complete';
  const labels = maintenanceActionLabel(action);
  const icon = complete ? '🟢' : '🔴';
  const version = release?.current_version || release?.current || release?.version;
  const lines = [`${icon} **${complete ? labels.complete : 'Maintenance stopped safely'}**`];
  if (version) lines.push(`Running version · **${safeUpdateText(version, 60)}**`);
  if (release?.detail) lines.push(safeUpdateText(release.detail, 360));
  const events = Array.isArray(release?.events) && release.events.length
    ? release.events.slice(-6).map((event) => `• ${safeUpdateText(event.message, 180)}`).join('\n')
    : 'No host bridge events were returned.';
  return base(
    `${botName()} // maintenance result`,
    lines.join('\n'),
    `Manual maintenance · ${complete ? 'result verified' : 'verification incomplete'}`,
  ).setColor(complete ? colors.ok : colors.bad).addFields({ name: 'Recent activity', value: events.slice(0, 1024), inline: false });
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
    'Manual release workflow · control containers verified',
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
      { name: '🧾 Host specifications', value: `**OS** ${operatingSystemLabel(data, 'Host OS unavailable')}\n${knownContainerOs(data) ? `**Control container** ${operatingSystemLabel({ os: containerOsInfo(data) }, 'Container OS unavailable')}\n` : ''}**CPU** ${data.specs?.cpu_model || 'Unknown'}\n**Frequency** ${frequency(data)}\n**Cores** ${data.specs?.logical_cores || '—'} logical • **Architecture** ${data.specs?.architecture || '—'}\n**RAM** ${bytes(data.memory.total)} • **Speed** ${memorySpeed(data)}\n**Kernel** ${data.specs?.kernel || 'Unknown'}\n**Node** ${data.hostname}`, inline: false },
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
  return base('Services', description, 'Live Docker catalogue · lifecycle controls can be reviewed in /settings').setColor(healthy === services.length ? colors.ok : colors.warn);
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

export function networkEmbed(providers, summary = null, hostStatus = {}, connectivity = null) {
  const rows = Array.isArray(providers) ? providers : [];
  const connectivityFields = [];
  if (connectivity?.gateway) {
    const gateway = connectivity.gateway;
    const latency = Number.isFinite(Number(gateway.latency_ms)) ? `${Math.round(Number(gateway.latency_ms))} ms` : 'not measured';
    connectivityFields.push({ name: '🚪 Internal gateway', value: `${gateway.reachable ? '🟢 Reachable' : gateway.configured ? '🟡 Discovered · no response' : '⚪ Not detected'}\n${latency}${gateway.probe_type ? ` · ${safeUpdateText(gateway.probe_type, 24)}` : ''}`, inline: true });
  }
  if (connectivity?.dns) {
    const dns = connectivity.dns;
    const latency = Number.isFinite(Number(dns.latency_ms)) ? ` · ${Math.round(Number(dns.latency_ms))} ms` : '';
    connectivityFields.push({ name: '🧭 DNS setup', value: `${dns.reachable ? '🟢 Answering' : dns.configured ? '🟡 Configured · no response' : '⚪ Not configured'}${latency}\n${safeUpdateText(dns.detail || '', 120)}`, inline: true });
  }
  if (!rows.length) {
    const status = networkStackStatus(summary);
    return base(commandTitle(hostStatus, 'network'), `No DNS or network services were detected.${status ? `\n\n${status}` : ''}`, 'Auto-detected providers · gateway/DNS probes are read-only').setColor(summary?.assessed && !summary.complete ? colors.warn : colors.idle)
      .addFields(...connectivityFields);
  }
  const online = rows.filter((provider) => provider.online).length;
  const lines = rows.map(providerLine).join('\n');
  const containers = rows.map((provider) => provider.container).filter(Boolean);
  const completeness = networkStackStatus(summary);
  const description = `${online === rows.length ? '🟢' : '🔴'} **${online}/${rows.length} detected providers online**${completeness ? `\n${completeness}` : ''}\n${lines}`;
  return base(commandTitle(hostStatus, 'network'), description, 'Auto-detected providers · gateway/DNS probes are read-only')
    .setColor(summary?.assessed && !summary.complete ? colors.warn : online === rows.length ? colors.ok : colors.bad)
    .addFields(...connectivityFields, { name: 'Detected services', value: containers.length ? containers.map((container) => `• ${safeUpdateText(container, 90)}`).join('\n').slice(0, 1024) : 'External provider endpoint', inline: false });
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
  const backTarget = options.backTarget || 'panel';
  const backLabel = options.backLabel || (backTarget === 'settings' ? 'Back to settings' : 'Back to panel');
  const selectPrefix = options.selectPrefix || 'control:select';
  const togglePrefix = options.togglePrefix || 'control-toggle';
  const pagePrefix = options.pagePrefix || 'controls:page';
  if (service) {
    const backId = backTarget === 'panel'
      ? (page > 0 ? `control:back:${page + 1}` : 'control:back')
      : (page > 0 ? `control:back:${page + 1}:${backTarget}` : `control:back:${backTarget}`);
    const detailBackLabel = options.detailBackLabel || (backTarget === 'settings' ? backLabel : 'Back to controls');
    const buttons = [new ButtonBuilder().setCustomId(backId).setLabel(detailBackLabel).setEmoji('⬅️').setStyle(ButtonStyle.Secondary)];
    if (options.allowActions !== false && !service.protected) {
      const active = service.enabled ?? service.manageable;
      buttons.unshift(new ButtonBuilder().setCustomId(`${togglePrefix}:${service.key}:${active ? 'off' : 'on'}`).setLabel(active ? 'Disable controls' : 'Enable controls').setEmoji(active ? '⏸️' : '✅').setStyle(active ? ButtonStyle.Danger : ButtonStyle.Success));
    }
    return [new ActionRowBuilder().addComponents(buttons)];
  }
  const pageStart = page * pageSize;
  const pageEntries = entries.slice(pageStart, pageStart + pageSize);
  const refreshPrefix = options.refreshPrefix || 'controls:refresh';
  const navigation = [new ButtonBuilder().setCustomId(`${refreshPrefix}:${page + 1}`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary), backButton(backTarget, backLabel)];
  if (page > 0) navigation.push(new ButtonBuilder().setCustomId(`${pagePrefix}:${page}`).setLabel('Previous').setEmoji('⬅️').setStyle(ButtonStyle.Secondary));
  if (page < pageCount - 1) navigation.push(new ButtonBuilder().setCustomId(`${pagePrefix}:${page + 2}`).setLabel('Next').setEmoji('➡️').setStyle(ButtonStyle.Secondary));
  const rows = [new ActionRowBuilder().addComponents(navigation)];
  if (options.allowActions !== false) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(options.modeCustomId || 'controls:mode')
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
        .setCustomId(`${selectPrefix}:${page + 1}:${Math.floor(index / 25) + 1}`)
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
      { name: 'CPU & processes', value: `${cpu}\n${pids} processes (PIDs)\nPIDs are process IDs; the count helps spot leaks.`, inline: true },
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
    new ButtonBuilder().setCustomId('nav:panel').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('nav:services').setLabel('Services').setEmoji('🧩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:minecraft').setLabel('Minecraft').setEmoji('⛏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:storage').setLabel('Storage').setEmoji('💾').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:media').setLabel('Media').setEmoji('🎬').setStyle(ButtonStyle.Secondary),
  ), new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('nav:tasks').setLabel('Tasks').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:network').setLabel('Network').setEmoji('🌐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:updates').setLabel('Updates').setEmoji('⬆️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('nav:settings').setLabel('Settings').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
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
