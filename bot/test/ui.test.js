import test from 'node:test';
import assert from 'node:assert/strict';
import { actionLoadingEmbed, bar, base, botReleaseLoadingEmbed, botReleaseResultEmbed, botReleaseSummary, bytes, controlsEmbed, controlsRows, duration, healthEmbed, helpEmbed, hostUpdateSummary, loadingEmbed, mediaEmbed, minecraftEmbed, minecraftRows, networkEmbed, operatingSystemLabel, operatingSystemShortLabel, panelEmbed, pingEmbed, reportEmbeds, serviceRows, servicesEmbed, statusEmbed, systemUpdateLoadingEmbed, systemUpdateResultEmbed, taskDetailEmbed, tasksEmbed, tasksLoadingEmbed, tasksRows, updateLoadingEmbed, updateResultEmbed, updateResultRows, updatesEmbed, updatesRows } from '../src/ui.js';
import { minecraftInternals } from '../src/minecraft.js';

const sampleStatus = {
  hostname: 'atlas', timestamp: new Date().toISOString(), cpu_percent: 12.5, load: [0.1, 0.2, 0.3],
  temperature_c: 51, uptime_seconds: 86400, memory: { used: 4e9, total: 32e9, swap_used: 0, swap_total: 8e9 },
  storage: [{ label: 'System SSD', used: 50e9, total: 465e9, free: 415e9, percent: 11 }, { label: 'Media HDD', used: 639e9, total: 1833e9, free: 1194e9, percent: 35 }],
  drives: [{ model: 'INTEL SSD', state: 'Healthy', temperature_c: 33, warning: false, critical: false }],
  specs: { cpu_model: 'Intel CPU', observed_ghz: 3.0, ram_speed_mhz: [2666], logical_cores: 8, architecture: 'x86_64', kernel: '6.8.0' },
  containers: { running: 38, total: 38, tracked_running: 19, tracked_total: 19, unhealthy: [] },
};

const sampleServices = [{ key: 'jellyfin', label: 'Jellyfin', container: 'jellyfin', state: 'running', health: 'process' }];
const sampleMedia = [{ label: 'Jellyfin', online: true, latency_ms: 4 }];

test('formats host measurements for phone-friendly embeds', () => {
  assert.equal(bytes(1073741824), '1.0 GiB');
  assert.equal(duration(90061), '1d 1h 1m');
  assert.match(bar(50), /50%/);
});

test('uses the detected operating system and provides distinct help and ping views', () => {
  const fedora = { os: { id: 'fedora', name: 'Fedora Linux', pretty_name: 'Fedora Linux 42' } };
  assert.equal(operatingSystemLabel(fedora), 'Fedora Linux 42');
  assert.equal(operatingSystemShortLabel(fedora), 'Fedora Linux');
  assert.match(helpEmbed().toJSON().description, /read-first control surface/i);
  const ping = pingEmbed({ processingMs: 12, websocketMs: 34 }).toJSON();
  assert.match(ping.description, /12 ms/);
  assert.match(ping.description, /34 ms/);
});

test('shared footer keeps operational notes compact and consistent', () => {
  const embed = base('Example', 'Main result', 'Verification: backup requested · service ping required').toJSON();
  assert.equal(embed.footer.text, 'Verification: backup requested · service ping required');
  assert.ok(embed.timestamp);
  assert.doesNotMatch(embed.fields?.[0]?.value || '', /Verification/);
});

test('status embed remains within Discord field limits', () => {
  const embed = statusEmbed(sampleStatus).toJSON();
  assert.equal(embed.title, 'atlas // system overview');
  assert.ok(embed.fields.every((field) => field.value.length <= 1024));
  assert.match(embed.fields.find((field) => field.name === 'CPU').value, /Load 1\/5m/);
  assert.doesNotMatch(embed.fields.find((field) => field.name === 'CPU').value, /15m/);
});

test('loading embed reports the request phase, elapsed time, and animated frame', () => {
  const first = loadingEmbed('Loading', 0, 0, {
    steps: ['Request sent', 'Waiting for response', 'Formatting result'],
    elapsedSeconds: 0,
    phase: 'Request sent',
    detail: 'Read-only request',
  }).toJSON().description;
  const second = loadingEmbed('Loading', 1, 1, {
    steps: ['Request sent', 'Waiting for response', 'Formatting result'],
    elapsedSeconds: 4.2,
    phase: 'Still working',
    detail: 'Read-only request',
  }).toJSON().description;
  assert.match(first, /Request sent/);
  assert.match(first, /⏳ Request sent/);
  assert.match(second, /Still working/);
  assert.match(second, /⏳ Waiting for response/);
  assert.match(second, /4s elapsed/);
  assert.notEqual(first.slice(0, 1), second.slice(0, 1));
});

test('media embed renders active playback details when available', () => {
  const embed = mediaEmbed(sampleMedia, {
    enabled: true,
    sessions: [{
      title: 'Daredevil — S01E01 Into the Ring', user: 'Sai', device: 'Jellyfin Web',
      state: 'Playing', progress_percent: 42, play_method: 'Direct play', stream_detail: '1920×1080 • H264 • AAC',
    }],
    recently_added: [{ title: 'Daredevil — S01E01 Into the Ring', type: 'Episode', year: 2015 }],
    library: { Movies: 42, Series: 12, Episodes: 188 },
    alerts: [],
  }, sampleStatus, {
    available: true,
    running: 7,
    total: 7,
    sampled: 7,
    memory_used: 2.5e9,
    cpu_percent: 9.2,
    failed: [],
    not_running: [],
  }).toJSON();
  const field = embed.fields.find((item) => item.name.includes('Active sessions'));
  assert.match(field.name, /1/);
  assert.match(field.value, /Daredevil/);
  assert.match(field.value, /42%/);
  assert.match(field.value, /Direct play/);
  assert.match(field.value, /1920×1080/);
  assert.match(embed.fields.find((item) => item.name.includes('Recently added')).value, /S01E01/);
  assert.match(embed.fields.find((item) => item.name === '📚 Jellyfin library').value, /Movies/);
  assert.match(embed.fields.find((item) => item.name === '📊 Quick status').value, /1\/1\*\* endpoints online/);
  const overall = embed.fields.find((item) => item.name === '📈 Media stack · overall');
  assert.match(overall.value, /7\/7\*\* containers running/);
  assert.match(overall.value, /2.3 GiB.*RAM working set/);
  assert.match(overall.value, /9.2%.*CPU sum/);
  assert.match(embed.fields.find((item) => item.name === '💾 Media volume').value, /35%/);
  assert.match(embed.fields.find((item) => item.name === '💾 Media volume').value, /595\.1 GiB used/);
  const recentWithSeason = mediaEmbed(sampleMedia, { enabled: true, recently_added: [{ title: "Marvel's The Defenders", type: 'Season', season: 1 }] }, sampleStatus).toJSON();
  assert.match(recentWithSeason.fields.find((item) => item.name === '🆕 Recently added').value, /Defenders.*S01/);
});

test('media embed states an assessed incomplete stack with missing providers', () => {
  const embed = mediaEmbed(sampleMedia, null, sampleStatus, null, {
    assessed: true,
    complete: false,
    missing: ['Seerr', 'Radarr'],
    expected: ['Jellyfin', 'Seerr', 'Radarr'],
    detail: 'Incomplete · missing Seerr, Radarr',
  }).toJSON();
  const overall = embed.fields.find((field) => field.name === '📈 Media stack · overall');
  assert.match(overall.value, /Incomplete/);
  assert.match(overall.value, /Seerr.*Radarr/);
});

test('network embed reports configured incompleteness without listing absent providers as detected', () => {
  const embed = networkEmbed([
    { id: 'pihole', label: 'Pi-hole', online: true, latency_ms: 3, container: 'pihole-1', detail: 'endpoint reachable' },
  ], {
    assessed: true,
    complete: false,
    expected: ['Pi-hole', 'Technitium DNS'],
    missing: ['Technitium DNS'],
    detail: 'Incomplete · missing Technitium DNS',
  }).toJSON();
  assert.match(embed.description, /Network stack incomplete/);
  assert.match(embed.description, /Technitium DNS/);
  assert.doesNotMatch(embed.description, /Technitium DNS.*online/);
  assert.equal(embed.color, 0xfee75c);
});

test('Plex-only media views do not claim that Jellyfin is missing', () => {
  const embed = mediaEmbed([
    { id: 'plex', label: 'Plex', online: true, latency_ms: 5 },
  ], null, sampleStatus, null, {
    assessed: true,
    complete: false,
    missing: ['Seerr'],
    expected: ['Plex', 'Seerr'],
    detail: 'Incomplete · missing Seerr',
  }, { enabled: false, detail: 'Plex read-only token is not configured' }).toJSON();
  const quick = embed.fields.find((field) => field.name === '📊 Quick status').value;
  assert.match(quick, /Plex API/);
  assert.doesNotMatch(quick, /Jellyfin API/);
});

test('panel, diagnostic, and detailed report have distinct titles and specs', () => {
  assert.equal(panelEmbed(sampleStatus, sampleServices, sampleMedia).toJSON().title, 'atlas // control centre');
  assert.equal(healthEmbed(sampleStatus, sampleServices, sampleMedia).toJSON().title, 'atlas // health diagnostic');
  const reports = reportEmbeds(sampleStatus, sampleServices, sampleMedia, []).map((embed) => embed.toJSON());
  assert.equal(reports.length, 2);
  assert.match(reports[0].fields.find((field) => field.name.includes('Host specifications')).value, /Intel CPU/);
  assert.match(reports[0].fields.find((field) => field.name.includes('Host specifications')).value, /2666 MHz/);
  assert.match(reports[0].fields.find((field) => field.name.includes('System telemetry')).value, /Load 1\/5\/15m/);
  assert.match(reports[1].fields.find((field) => field.name.includes('Services')).value, /running • process alive/);
});

test('controls selection opens the selected container detail view', () => {
  const services = [
    { key: 'jellyfin', label: 'Jellyfin', container: 'jellyfin-1', state: 'running', enabled: true, manageable: true },
    { key: 'paperless', label: 'Paperless-ngx', container: 'paperless-1', state: 'running', enabled: false, manageable: false },
  ];
  const policy = { mode: 'opt-in', services };
  const detail = controlsEmbed([services[1]], policy, { detail: true, selectedKey: 'paperless' }).toJSON();
  assert.match(detail.description, /Paperless-ngx/);
  assert.match(detail.description, /Read-only/);
  assert.doesNotMatch(detail.description, /Jellyfin/);
  const rows = controlsRows([services[1]], policy, { detail: true, selectedKey: 'paperless' });
  assert.equal(rows.length, 1);
  const buttons = rows[0].toJSON().components;
  assert.equal(buttons.find((button) => button.custom_id === 'control:back').label, 'Back to controls');
});

test('controls paginate large auto-discovered catalogues without invalid component rows', () => {
  const services = Array.from({ length: 126 }, (_, index) => ({
    key: `container-${index}`,
    label: `Container ${index}`,
    container: `container-${index}`,
    state: 'running',
    enabled: false,
    manageable: false,
  }));
  const policy = { mode: 'opt-in', services };
  const firstPage = controlsRows(services, policy, { page: 0 }).map((row) => row.toJSON());
  const lastPage = controlsRows(services, policy, { page: 1 }).map((row) => row.toJSON());
  assert.equal(firstPage.length, 5);
  assert.equal(firstPage[0].components[0].custom_id, 'controls:refresh:1');
  assert.equal(firstPage[0].components.at(-1).custom_id, 'controls:page:2');
  assert.equal(firstPage[1].components[0].custom_id, 'controls:mode');
  assert.equal(firstPage[2].components[0].custom_id, 'control:select:1:1');
  assert.equal(firstPage[4].components[0].custom_id, 'control:select:1:3');
  assert.equal(lastPage.length, 5);
  assert.equal(lastPage[0].components.at(-1).custom_id, 'controls:page:1');
  assert.equal(lastPage[1].components[0].custom_id, 'controls:mode');
  assert.equal(lastPage[2].components[0].custom_id, 'control:select:2:1');
  const embed = controlsEmbed(services, policy, { page: 1 }).toJSON();
  assert.match(embed.description, /Page \*\*2\/2\*\*/);
  assert.match(embed.fields[0].value, /Container 75/);
});

test('Runtipi update UI is bounded and separates status from actions', () => {
  const snapshot = {
    available: true,
    checked_at: new Date().toISOString(),
    installed_total: 19,
    updates: [
      { id: 'jellyfin', label: 'Jellyfin', current: '10.11.8', latest: '10.11.9' },
      { id: 'sonarr', label: 'Sonarr', current: '4.0.18.2937', latest: '4.0.19.2979' },
    ],
    protected_updates: [{ id: 'homelab-control', label: 'Homelab Control', current: '0.1.0', latest: '0.1.1' }],
  };
  const embed = updatesEmbed(snapshot).toJSON();
  assert.match(embed.description, /2 updates available/);
  assert.match(embed.fields[0].value, /Jellyfin/);
  assert.ok(embed.fields.every((field) => field.value.length <= 1024));
  assert.match(embed.footer.text, /^Runtipi lifecycle/);
  assert.equal(embed.fields.some((field) => field.name === 'Verification'), false);
  assert.equal(updatesRows(snapshot, false).length, 1);
  assert.equal(updatesRows(snapshot, true).length, 3);
  assert.match(updateLoadingEmbed('Updating', 3, 2).toJSON().description, /Pinging the updated container/);
  const updateFrame = updateLoadingEmbed('Updating Jellyfin…', 1, 1, 'Runtipi is completing the request; the bot will report success only after the Docker/app ping answers.').toJSON();
  assert.match(updateFrame.description, /◓/);
  assert.match(updateFrame.description, /Runtipi is completing the request/);
  assert.match(updateResultEmbed({ status: 'updated', verified: true, id: 'jellyfin', label: 'Jellyfin', latest: '10.11.9', verification: { detail: 'Docker running • HTTP 200' } }).toJSON().description, /Update verified/);
  const bulk = updateResultEmbed({
    status: 'updated', successful: 1, failed: 0, skipped: 0,
    results: [{ status: 'updated', verified: true, id: 'jellyfin', label: 'Jellyfin', verification: { detail: 'Docker running • TCP 40178 • 42 ms' } }],
  }).toJSON();
  assert.match(bulk.fields.find((field) => field.name === 'Results').value, /updated · 42 ms/);
  assert.doesNotMatch(bulk.fields.find((field) => field.name === 'Results').value, /Docker ping OK/);
  assert.equal(updateResultRows()[0].components[0].data.custom_id, 'updates:back');
  assert.equal(updateResultRows()[0].components[0].data.label, 'Back to updates');
});

test('bot release UI reports GitHub checks and exposes guarded update and rollback actions', () => {
  const snapshot = {
    available: true,
    checked_at: new Date().toISOString(),
    updates: [],
    protected_updates: [],
    bot: {
      available: true,
      configured: true,
      repository: 'example/homelab-control',
      current: '0.3.17',
      latest: '0.3.18',
      update_available: true,
      asset_verified: true,
      update_supported: true,
      rollback_available: true,
      rollback_source: 'github',
      rollback_version: '0.3.16',
      github_rollback_available: true,
      phase: 'idle',
      detail: 'A newer verified release is ready',
    },
  };
  const embed = updatesEmbed(snapshot).toJSON();
  const releaseField = embed.fields.find((field) => field.name.includes('Homelab Control release'));
  assert.match(releaseField.value, /Update available/);
  assert.match(releaseField.value, /0\.3\.17/);
  assert.match(releaseField.value, /0\.3\.18/);
  assert.match(botReleaseSummary(snapshot.bot), /Verified archive ready to install/);
  assert.match(botReleaseSummary(snapshot.bot), /from GitHub/);
  assert.match(botReleaseSummary({ ...snapshot.bot, available: false, detail: 'GitHub latest unavailable' }), /Revert available/);
  const rows = updatesRows(snapshot, true);
  assert.ok(rows.length <= 5);
  const rowIds = rows.flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.ok(rowIds.includes('updates:bot-update'));
  assert.ok(rowIds.includes('updates:bot-rollback'));
  const rollbackButton = rows.flatMap((row) => row.toJSON().components).find((component) => component.custom_id === 'updates:bot-rollback');
  assert.equal(rollbackButton.label, 'Revert to v0.3.16');
  const prefixedRows = updatesRows({ ...snapshot, bot: { ...snapshot.bot, rollback_version: 'v0.3.16' } }, true);
  const prefixedRollbackButton = prefixedRows.flatMap((row) => row.toJSON().components).find((component) => component.custom_id === 'updates:bot-rollback');
  assert.equal(prefixedRollbackButton.label, 'Revert to v0.3.16');
  const loading = botReleaseLoadingEmbed('update', { phase: 'downloading', latest: '0.3.18', events: [{ message: 'Downloading the verified GitHub release archive' }] }, 2).toJSON();
  assert.match(loading.description, /Downloading the release archive/);
  assert.match(loading.description, /both control containers answer their health checks/);
  assert.match(loading.fields[0].value, /verified GitHub release archive/);
  const result = botReleaseResultEmbed('update', { phase: 'complete', current: '0.3.18', previous_version: '0.3.17', detail: 'Release 0.3.18 is running and both control health checks passed', events: [{ message: 'Bot release applied and verified' }] }).toJSON();
  assert.match(result.description, /Bot update verified/);
  assert.match(result.description, /0\.3\.18/);
  assert.match(result.fields[0].value, /Bot release applied and verified/);
  const rollback = botReleaseResultEmbed('rollback', { phase: 'rolled_back', current: '0.3.16', previous_version: '0.3.17', rollback_source: 'github', detail: 'Release 0.3.16 is running and both control health checks passed', events: [{ message: 'Previous bot release restored and verified' }] }).toJSON();
  assert.match(rollback.description, /Previous bot release restored/);
  assert.match(rollback.description, /GitHub archive/);
});

test('Ubuntu maintenance UI reports pending security work and guarded actions', () => {
  const system = {
    available: true,
    pending_count: 10,
    security_count: 3,
    esm_enabled: false,
    notice: 'ESM Apps is not enabled',
    maintenance_available: true,
    phase: 'ready_for_reboot',
    reboot_required: true,
    job_id: 'job-123',
    events: [{ message: 'Updates applied successfully' }],
  };
  const embed = updatesEmbed({ available: true, updates: [], protected_updates: [] }, system).toJSON();
  assert.match(embed.fields.find((field) => field.name === '🐧 Ubuntu host').value, /10 pending/);
  assert.match(embed.fields.find((field) => field.name === '🐧 Ubuntu host').value, /restart required/);
  assert.equal(updatesRows({ updates: [] }, system, true).length, 2);
  assert.match(systemUpdateLoadingEmbed({ ...system, phase: 'applying' }, 1).toJSON().description, /applying\.\./);
  assert.match(systemUpdateLoadingEmbed({ ...system, phase: 'applying' }, 1).toJSON().footer.text, /Ubuntu maintenance/);
  assert.match(systemUpdateResultEmbed(system).toJSON().description, /restart pending/);
  assert.match(systemUpdateResultEmbed(system).toJSON().footer.text, /restart is separate/);
  assert.ok(systemUpdateResultEmbed(system).toJSON().fields.every((field) => field.value.length <= 1024));
  const report = reportEmbeds(sampleStatus, sampleServices, sampleMedia, [], system).map((item) => item.toJSON());
  assert.match(report[0].fields.find((field) => field.name === '🐧 Ubuntu update status').value, /Security/);
});

test('Ubuntu update summary explains security classification and phasing', () => {
  const summary = hostUpdateSummary({
    available: true,
    pending_count: 2,
    security_count: 1,
    esm_enabled: false,
    security_detail: 'Security packages are marked with a lock icon below',
    phase: 'idle',
    packages: [
      { name: 'openssl', latest: '3.0.0', origin: 'Ubuntu:24.04/noble-security', security: true },
      { name: 'byobu', latest: '6.11.1', origin: 'Ubuntu:24.04/noble-updates', security: false },
    ],
    deferred_packages: ['libpython3.12'],
  });
  assert.match(summary, /2 pending/);
  assert.match(summary, /Security.*1 update/);
  assert.match(summary, /Ubuntu Pro \/ ESM Apps/);
  assert.match(summary, /Phase.*Idle/);
  assert.match(summary, /openssl/);
  assert.match(summary, /noble-security/);
  assert.match(summary, /Deferred by Ubuntu phasing/);
});

test('task manager shows Docker RAM breakdown without control actions', () => {
  const snapshot = {
    available: true,
    checked_at: new Date().toISOString(),
    host_memory: { used: 6e9, total: 32e9 },
    docker: { running: 2, sampled: 2, failed: 0, memory_used: 2.5e9, cpu_percent: 14.2 },
    containers: [
      { id: 'jellyfin-id', name: 'jellyfin', label: 'Jellyfin', image: 'jellyfin/jellyfin:10.11.8', memory_used: 2e9, memory_limit: 8e9, memory_percent: 25, cpu_percent: 9.2, pids: 14, network_rx: 10e6, network_tx: 4e6 },
      { id: 'agent-id', name: 'agent', label: 'Control agent', image: 'local/homelab-control-agent:0.2.0', memory_used: 0.5e9, memory_limit: 128e6, memory_percent: 390.6, cpu_percent: 5, pids: 3, network_rx: 1e6, network_tx: 2e6 },
    ],
    discord_bot: { id: 'bot-id', name: 'homelab-control-bot-1', label: 'Homelab Control (Discord bot)', role: 'discord-bot', image: 'local/homelab-control-bot:0.2.0', memory_used: 0.25e9, memory_limit: 256e6, memory_percent: 9.8, cpu_percent: 1.1, pids: 8, network_rx: 2e6, network_tx: 1e6 },
    failed: [],
  };
  const embed = tasksEmbed(snapshot).toJSON();
  assert.match(embed.title, /Task manager/);
  assert.match(embed.fields.find((field) => field.name.includes('Media stack')).name, /1 container/);
  assert.match(embed.fields.find((field) => field.name.includes('Media stack')).value, /Jellyfin/);
  assert.match(embed.fields.find((field) => field.name.includes('Control plane')).value, /Homelab Control/);
  assert.match(embed.footer.text, /PIDs are in container details/);
  assert.equal(embed.fields.some((field) => field.name.includes('Reading guide')), false);
  assert.ok(embed.fields.every((field) => field.value.length <= 1024));
  assert.equal(tasksRows(snapshot).length, 2);
  assert.equal(tasksRows(snapshot, true).length, 2);
  assert.match(tasksEmbed(snapshot, { live: true, tick: 2 }).toJSON().description, /new sample requested every 5s/);
  assert.match(tasksEmbed(snapshot, { ended: true }).toJSON().description, /Live window complete/);
  const normal = tasksEmbed(snapshot, { live: true, tick: 2 }).toJSON();
  const refreshing = tasksEmbed(snapshot, { live: true, tick: 2, refreshing: true, refreshTick: 1, refreshElapsedSeconds: 2.2 }).toJSON();
  assert.match(refreshing.footer.text, /Refreshing Docker stats/);
  assert.match(refreshing.footer.text, /last complete sample retained/);
  assert.equal(refreshing.fields.find((field) => field.name.startsWith('🧠 Host')).value, normal.fields.find((field) => field.name.startsWith('🧠 Host')).value);
  assert.match(taskDetailEmbed(snapshot.containers[0]).toJSON().fields.find((field) => field.name === 'Container image').value, /jellyfin/);
});

test('task manager keeps lightweight qBittorrent visible outside the top ten', () => {
  const containers = Array.from({ length: 29 }, (_, index) => ({
    id: `container-${index}`,
    name: `service-${index}`,
    label: `Service ${index}`,
    image: `example/service:${index}`,
    memory_used: (30 - index) * 1e6,
    memory_limit: 256e6,
    memory_percent: 1,
    cpu_percent: 0.1,
    pids: 1,
  }));
  containers.push({
    id: 'qbit-id', name: 'qbittorrent_migrated-qbittorrent-1', label: 'qBittorrent',
    image: 'lscr.io/linuxserver/qbittorrent:5.2.3', memory_used: 50e6, memory_limit: 512e6,
    memory_percent: 9.8, cpu_percent: 0.2, pids: 4,
  });
  const snapshot = {
    available: true,
    checked_at: new Date().toISOString(),
    host_memory: { used: 6e9, total: 32e9 },
    docker: { running: 30, sampled: 30, failed: 0, memory_used: 2.5e9, cpu_percent: 14.2 },
    containers,
    failed: [],
  };
  const embed = tasksEmbed(snapshot).toJSON();
  assert.match(embed.fields.find((field) => field.name.includes('Media stack')).value, /qBittorrent/);
  const options = tasksRows(snapshot)[1].toJSON().components[0].options;
  assert.ok(options.some((option) => option.label === 'qBittorrent'));
});

test('task manager paginates container selectors without dropping the catalogue', () => {
  const containers = Array.from({ length: 31 }, (_, index) => ({
    id: `container-${index}`,
    name: `container-${index}`,
    label: `Container ${index}`,
    memory_used: 1024,
    memory_limit: 4096,
    memory_percent: 25,
    cpu_percent: 1,
  }));
  const rows = tasksRows({ containers, discord_bot: null });
  assert.equal(rows.length, 3);
  assert.equal(rows[1].toJSON().components[0].options.length, 25);
  assert.equal(rows[2].toJSON().components[0].options.length, 6);
  assert.equal(rows[2].toJSON().components[0].custom_id, 'tasks:select:2');
});

test('Minecraft views show backend and per-server resource samples', () => {
  const servers = [
    { id: 'survival', name: 'Survival', type: 'Paper', version: '1.21.8', panel: 'Crafty Controller', backend: 'crafty', running: true, resources: { cpu_percent: 6.4, memory_used: 768e6, pids: 24 } },
    { id: 'creative', name: 'Creative', type: 'Docker Minecraft server', version: 'itzg/minecraft-server:java21', backend: 'docker', running: false, state: 'exited' },
  ];
  const embed = minecraftEmbed(servers).toJSON();
  assert.match(embed.description, /1\/2 online/);
  assert.match(embed.description, /Crafty Controller.*Docker discovery/);
  assert.match(embed.description, /CPU 6\.4%.*RAM 732 MiB.*PIDs 24/);
  assert.match(embed.description, /Creative/);
  const resources = minecraftInternals.normalizeResources({ cpu_absolute: 3.25, memory_bytes: 1024, memory_limit_bytes: 4096, pids: 7, uptime: 120 });
  assert.deepEqual(resources, { cpu_percent: 3.3, memory_used: 1024, memory_limit: 4096, pids: 7, uptime_seconds: 120 });
  const pterodactyl = minecraftInternals.pterodactylServer({ attributes: { identifier: 'abc123', name: 'Panel server', image: 'java:21', limits: { memory: 2048, cpu: 200 } } }, 'pterodactyl');
  assert.equal(pterodactyl.id, 'abc123');
  assert.equal(pterodactyl.panel, 'Pterodactyl Panel');
  assert.equal(pterodactyl.limits.memory, 2048);
  const crafty = minecraftInternals.normalizeCraftyServers({ data: { servers: [{ server_data: { server_id: 42, server_name: 'Survival', running: true, minecraft_version: '1.21.8', type: 'Paper' } }] } });
  assert.deepEqual(crafty[0], {
    id: '42', name: 'Survival', running: true, version: '1.21.8', type: 'Paper', backend: 'crafty', panel: 'Crafty Controller', manageable: true, raw: crafty[0].raw,
  });
  const rows = minecraftRows(Array.from({ length: 26 }, (_, index) => ({ id: `server-${index}`, name: `Server ${index}`, running: index === 0 })));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].toJSON().components[0].custom_id, 'nav:panel');
  assert.equal(rows[2].toJSON().components[0].options.length, 1);
});

test('task manager gives Minecraft its own category', () => {
  const snapshot = {
    available: true,
    checked_at: new Date().toISOString(),
    host_memory: { used: 3e9, total: 32e9 },
    docker: { running: 2, sampled: 2, failed: 0, memory_used: 1.2e9, cpu_percent: 7.2 },
    containers: [
      { id: 'mc', name: 'paper-survival', label: 'Paper Survival', image: 'itzg/minecraft-server:java21', memory_used: 1e9, memory_limit: 8e9, memory_percent: 12.5, cpu_percent: 7, pids: 24 },
      { id: 'docs', name: 'paperless-ngx', label: 'Paperless-ngx', image: 'paperlessngx/paperless-ngx:latest', memory_used: 0.2e9, memory_limit: 1e9, memory_percent: 20, cpu_percent: 0.2, pids: 5 },
    ],
    failed: [],
  };
  const embed = tasksEmbed(snapshot).toJSON();
  const field = embed.fields.find((item) => item.name.includes('Minecraft servers'));
  assert.ok(field);
  assert.match(field.name, /1 container/);
  assert.match(field.value, /Paper Survival/);
  assert.ok(!embed.fields.some((item) => item.name.includes('Minecraft servers') && item.value.includes('Paperless')));
});

test('task and action loaders expose honest animated states', () => {
  const taskFrame = tasksLoadingEmbed(2, 7.4).toJSON().description;
  assert.match(taskFrame, /Sampling the next point/);
  assert.match(taskFrame, /7s elapsed/);
  const actionFrame = actionLoadingEmbed('Jellyfin', 'restart', 1).toJSON();
  assert.match(actionFrame.description, /Request in flight/);
  assert.match(actionFrame.footer.text, /duplicate request/);
});

test('services view includes auto-discovered containers and paginates selectors', () => {
  const services = Array.from({ length: 28 }, (_, index) => ({
    key: index < 19 ? `service-${index}` : `container-${index}`,
    label: index === 19 ? 'Filebrowser Quantum' : `Service ${index}`,
    container: `container-${index}`,
    state: 'running',
    health: index === 19 ? 'healthy' : 'process',
    health_source: index === 19 ? 'docker' : 'process',
    manageable: index < 19,
    discovered: index >= 19,
  }));
  const embed = servicesEmbed(services).toJSON();
  assert.match(embed.description, /28\/28/);
  assert.match(embed.description, /\*\*9\*\* auto-detected/);
  assert.match(embed.description, /Filebrowser Quantum/);
  const health = healthEmbed(sampleStatus, services, sampleMedia).toJSON();
  assert.ok(health.fields.filter((field) => field.name.startsWith('Service health')).every((field) => field.value.length <= 1024));
  const report = reportEmbeds(sampleStatus, services, sampleMedia, []).map((item) => item.toJSON());
  assert.ok(report[1].fields.filter((field) => field.name.includes('Services')).every((field) => field.value.length <= 1024));
  const rows = serviceRows(services);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].toJSON().components[0].custom_id, 'nav:panel');
  assert.equal(rows[1].toJSON().components[0].options.length, 25);
  assert.equal(rows[2].toJSON().components[0].options.length, 3);
  assert.equal(rows[2].toJSON().components[0].custom_id, 'service:select:2');
});
