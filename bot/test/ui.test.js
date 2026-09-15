import test from 'node:test';
import assert from 'node:assert/strict';
import { actionLoadingEmbed, bar, base, botMaintenanceLoadingEmbed, botMaintenanceRestartEmbed, botMaintenanceResultEmbed, botReleaseLoadingEmbed, botReleaseRestartEmbed, botReleaseResultEmbed, botReleaseSummary, botRollbackConfirmationEmbed, botRollbackOptionsEmbed, botRollbackOptionsRows, botUpdateConfirmationEmbed, bytes, controlsEmbed, controlsRows, deepBackRow, duration, errorEmbed, healthEmbed, helpEmbed, hostRestartResultEmbed, hostRestartWaitingEmbed, hostUpdateSummary, loadingEmbed, mediaEmbed, minecraftEmbed, minecraftRows, networkEmbed, operatingSystemLabel, operatingSystemShortLabel, panelEmbed, panelRows, pingEmbed, postUpdateNoticeEmbed, reportEmbeds, serviceRows, servicesEmbed, settingsEmbed, settingsRows, statusEmbed, systemUpdateLoadingEmbed, systemUpdateResultEmbed, taskDetailEmbed, tasksEmbed, tasksLoadingEmbed, tasksRows, updateLoadingEmbed, updateResultEmbed, updateResultRows, updatesEmbed, updatesRows, weeklyHealthEmbed } from '../src/ui.js';
import { minecraftInternals } from '../src/minecraft.js';

const sampleStatus = {
  hostname: 'atlas', timestamp: new Date().toISOString(), cpu_percent: 12.5, load: [0.1, 0.2, 0.3],
  os: { id: 'ubuntu', name: 'Ubuntu', pretty_name: 'Ubuntu Server 24.04.4 LTS' },
  container_os: { id: 'alpine', name: 'Alpine Linux', pretty_name: 'Alpine Linux v3.24' },
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

test('explains Crafty certificate failures without claiming a Minecraft action ran', () => {
  const embed = errorEmbed('self-signed certificate').toJSON();
  assert.match(embed.description, /Minecraft panel.*TLS certificate.*rejected/i);
  assert.match(embed.description, /No Minecraft action was taken/i);
  assert.match(embed.description, /CRAFTY_CA_CERT_FILE/);
});

test('shows host and control-container operating systems separately', () => {
  const status = statusEmbed(sampleStatus).toJSON();
  assert.equal(status.fields.find((field) => field.name.includes('Host operating system')).value, 'Ubuntu Server 24.04.4 LTS');
  assert.equal(status.fields.find((field) => field.name === '📦 Control container').value, 'Alpine Linux v3.24');
  const update = hostUpdateSummary({
    available: true,
    os: sampleStatus.os,
    container_os: sampleStatus.container_os,
    pending_count: 0,
    security_count: 0,
    phase: 'idle',
  });
  assert.match(update, /Host OS.*Ubuntu Server 24\.04\.4 LTS/);
  assert.match(update, /Control container.*Alpine Linux v3\.24/);
  const unavailable = updatesEmbed(
    { available: true, updates: [], protected_updates: [] },
    { available: false, os: { id: 'unknown', name: 'Host OS unavailable', pretty_name: 'Host OS unavailable' }, detail: 'Host OS unavailable' },
  ).toJSON();
  assert.equal(unavailable.fields.find((field) => field.value.includes('Host OS unavailable')).name, '🖥️ Host updates');
  assert.doesNotMatch(unavailable.fields.find((field) => field.value.includes('Host OS unavailable')).name, /Host host/i);
});

test('shared footer keeps operational notes compact and consistent', () => {
  const embed = base('Example', 'Main result', 'Verification: backup requested · service ping required').toJSON();
  assert.equal(embed.footer.text, 'Verification: backup requested · service ping required');
  assert.ok(embed.timestamp);
  assert.doesNotMatch(embed.fields?.[0]?.value || '', /Verification/);
});

test('scheduled OTA completion is a compact separate embed', () => {
  const embed = postUpdateNoticeEmbed({ version: '0.4.0a', previous: '0.4.0' }).toJSON();
  assert.equal(embed.title, 'Homelab Control // update complete');
  assert.match(embed.description, /scheduled bot update.*0\.4\.0a/i);
  assert.match(embed.description, /from \*\*0\.4\.0\*\*/i);
  assert.equal(embed.footer.text, 'Automatic update · shown once after restart');
});

test('weekly report keeps the compact health card and adds updates with consistent bars', () => {
  const embed = weeklyHealthEmbed(sampleStatus, sampleServices, sampleMedia, {
    available: true,
    os: sampleStatus.os,
    pending_count: 2,
    security_count: 1,
  }, {
    available: true,
    updates: [{ label: 'Filebrowser', current: '1', latest: '2' }],
    bot: { configured: true, available: true, update_available: false, current: '0.4.0' },
  }, { assessed: true, complete: true, missing: [] }).toJSON();
  assert.equal(embed.title, 'atlas Weekly Health');
  assert.match(embed.description, /All monitored systems healthy/);
  assert.match(embed.fields.find((field) => field.name === '💾 Storage usage').value, /▰/);
  assert.match(embed.fields.find((field) => field.name === '💾 Storage usage').value, /46\.6 \/ 433\.1 GiB/);
  assert.match(embed.fields.find((field) => field.name === '⬆️ Updates').value, /Runtipi apps.*1 available/s);
  assert.match(embed.fields.find((field) => field.name === '⬆️ Updates').value, /Filebrowser.*1 → 2/s);
  assert.match(embed.fields.find((field) => field.name === '⬆️ Updates').value, /Ubuntu.*2 pending/s);
  assert.match(embed.fields.find((field) => field.name === '📦 Containers').value, /Media.*1\/1 online/);
  assert.ok(embed.fields.every((field) => field.value.length <= 1024));
});

test('weekly report omits optional sections that have no data', () => {
  const minimal = weeklyHealthEmbed({
    hostname: 'atlas', timestamp: new Date().toISOString(), uptime_seconds: 60,
    memory: { used: 1, total: 2, swap_total: 0 },
    storage: [{ label: 'System', used: 1, total: 2, percent: 50 }],
    containers: { running: 1, total: 1, unhealthy: [] },
    drives: [],
  }, [], [], null, { available: false, bot: { configured: false } }, null).toJSON();
  assert.equal(minimal.fields.some((field) => field.name.startsWith('🩺 Drive health')), false);
  assert.equal(minimal.fields.some((field) => field.name === '⬆️ Updates'), false);
});

test('weekly report keeps missing measurements honest instead of displaying zeroes', () => {
  const embed = weeklyHealthEmbed({
    hostname: 'atlas', timestamp: new Date().toISOString(),
    cpu_percent: null, temperature_c: null, memory: { used: null, total: null, swap_total: null },
    storage: [{ label: 'System', used: null, total: null, percent: null }],
    containers: { running: null, total: null }, drives: [],
  }, [], []).toJSON();
  const system = embed.fields.find((field) => field.name === '⚙️ System').value;
  assert.match(system, /CPU\*\* not reported/);
  assert.match(system, /Memory\*\* not reported/);
  assert.match(embed.fields.find((field) => field.name === '⏱️ Runtime').value, /not reported/);
  assert.match(embed.fields.find((field) => field.name === '💾 Storage usage').value, /not reported/);
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
  const panelWithoutUpdates = panelEmbed(sampleStatus, sampleServices, sampleMedia).toJSON();
  assert.doesNotMatch(panelWithoutUpdates.fields.find((field) => field.name === 'Software').value, /Runtipi apps/i);
  assert.equal(healthEmbed(sampleStatus, sampleServices, sampleMedia).toJSON().title, 'atlas // health diagnostic');
  const reports = reportEmbeds(sampleStatus, sampleServices, sampleMedia, []).map((embed) => embed.toJSON());
  assert.equal(reports.length, 2);
  assert.match(reports[0].fields.find((field) => field.name.includes('Host specifications')).value, /Intel CPU/);
  assert.match(reports[0].fields.find((field) => field.name.includes('Host specifications')).value, /2666 MHz/);
  assert.match(reports[0].fields.find((field) => field.name.includes('System telemetry')).value, /Load 1\/5\/15m/);
  assert.match(reports[1].fields.find((field) => field.name.includes('Services')).value, /running • process alive/);
});

test('panel refresh stays on the panel and all secondary views retain a back route', () => {
  const panel = panelRows().flatMap((row) => row.toJSON().components || []);
  assert.equal(panel[0].custom_id, 'nav:panel');
  const detail = panelRows(true).flatMap((row) => row.toJSON().components || []);
  assert.ok(detail.some((component) => component.custom_id === 'nav:panel'));
  assert.ok(detail.some((component) => component.custom_id === 'nav:panel:back'));
  assert.equal(new Set(detail.map((component) => component.custom_id)).size, detail.length);
});

test('deep views offer a direct home route beside their parent route', () => {
  const buttons = deepBackRow('updates', 'Back to updates')[0].toJSON().components;
  assert.deepEqual(buttons.map((button) => [button.custom_id, button.label]), [
    ['nav:updates', 'Back to updates'],
    ['nav:panel', 'Back to home'],
  ]);
  const detail = controlsRows([{ key: 'paperless', label: 'Paperless', container: 'paperless-1', enabled: false }], { mode: 'opt-in' }, { detail: true, selectedKey: 'paperless' })[0].toJSON().components;
  assert.ok(detail.some((button) => button.custom_id === 'nav:panel' && button.label === 'Back to home'));
  assert.equal(updateResultRows()[0].toJSON().components.at(-1).label, 'Back to home');
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
  assert.match(botReleaseSummary({ configured: true, available: true, channel: 'beta', current: '0.4.0', latest: '0.4.1', update_available: true, asset_verified: true, update_supported: true }), /beta live-patch route.*acknowledgement/i);
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
      asset_size: 12345678,
      update_available: true,
      asset_verified: true,
      update_supported: true,
      rollback_available: true,
      rollback_source: 'github',
      rollback_version: '0.3.16',
      github_rollback_available: true,
      rollback_options: [
        { version: '0.3.16', published_at: '2026-08-20T00:00:00Z', asset_digest: 'sha256:' + 'a'.repeat(64), asset_size: 2345678, approval: 'golden' },
        { version: '0.3.15', published_at: '2026-08-10T00:00:00Z', asset_digest: 'sha256:' + 'b'.repeat(64), asset_size: 3456789, approval: 'last_major' },
        { version: '0.2.9', published_at: '2026-07-10T00:00:00Z', asset_digest: 'sha256:' + 'c'.repeat(64), asset_size: 4567890 },
      ],
      rollback_quick_options: [
        { version: '0.3.16', quick_role: 'golden', asset_size: 2345678 },
        { version: '0.3.15', quick_role: 'last_major', asset_size: 3456789 },
      ],
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
  assert.match(botReleaseSummary(snapshot.bot), /12\.3 MB/);
  assert.match(botUpdateConfirmationEmbed({ latest: '0.3.18', asset_size: 1024 }).toJSON().description, /1 KB/);
  assert.doesNotMatch(botReleaseSummary({ ...snapshot.bot, asset_size: null }), /Source archive ·/);
  assert.match(botReleaseSummary(snapshot.bot), /from GitHub/);
  assert.match(botReleaseSummary({ ...snapshot.bot, available: false, detail: 'GitHub latest unavailable' }), /Rollback options/);
  const rows = updatesRows(snapshot, true);
  assert.ok(rows.length <= 5);
  const rowIds = rows.flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.ok(rowIds.includes('updates:bot-update'));
  assert.ok(rowIds.includes('updates:bot-rollback-options'));
  const rollbackButton = rows.flatMap((row) => row.toJSON().components).find((component) => component.custom_id === 'updates:bot-rollback-options');
  assert.equal(rollbackButton.label, 'Rollback options');
  const optionRows = botRollbackOptionsRows(snapshot.bot).map((row) => row.toJSON());
  assert.ok(optionRows.flatMap((row) => row.components).some((component) => component.custom_id === 'updates:bot-rollback-select'));
  assert.ok(optionRows.flatMap((row) => row.components).find((component) => component.custom_id === 'updates:bot-rollback-select').options.some((option) => option.value === '0.2.9'));
  const quickButtons = optionRows.flatMap((row) => row.components).filter((component) => component.custom_id.startsWith('updates:bot-rollback-version:'));
  assert.deepEqual(quickButtons.map((component) => component.label), ['Rollback to v0.3.16', 'Rollback to v0.3.15']);
  const optionsEmbed = botRollbackOptionsEmbed(snapshot.bot).toJSON();
  assert.match(optionsEmbed.title, /rollback options/i);
  assert.match(optionsEmbed.description, /only the approved golden target is recommended/i);
  assert.match(optionsEmbed.fields.find((field) => field.name === 'Quick rollback choices').value, /approved golden target/);
  assert.match(optionsEmbed.fields.find((field) => field.name === 'Quick rollback choices').value, /last major release fallback/);
  assert.doesNotMatch(optionsEmbed.fields.find((field) => field.name === 'Quick rollback choices').value, /0\.2\.9/);
  assert.equal(optionRows.flatMap((row) => row.components).find((component) => component.custom_id === 'updates:bot-rollback-select').placeholder, 'Select a legacy version · not recommended');
  assert.match(botRollbackOptionsEmbed({ ...snapshot.bot, rollback_options: [{ version: '0.3.16', asset_size: 1000000000 }], rollback_quick_options: [{ version: '0.3.16', quick_role: 'golden', asset_size: 1000000000 }] }).toJSON().fields[0].value, /1 GB/);
  assert.match(botRollbackOptionsEmbed({ ...snapshot.bot, rollback_options: [{ version: '0.3.16', asset_size: null }], rollback_quick_options: [{ version: '0.3.16', quick_role: 'golden', asset_size: null }] }).toJSON().fields[0].value, /size unavailable/);
  const rollbackConfirmation = botRollbackConfirmationEmbed(snapshot.bot, { version: '0.2.9' }).toJSON();
  assert.match(rollbackConfirmation.description, /0\.2\.9/);
  assert.match(rollbackConfirmation.description, /may be broken or obsolete/i);
  const retainedRows = botRollbackOptionsRows({ ...snapshot.bot, rollback_source: 'local', rollback_version: '0.3.17' }).flatMap((row) => row.toJSON().components);
  assert.ok(retainedRows.some((component) => component.custom_id === 'updates:bot-rollback-retained'));
  assert.equal(botRollbackConfirmationEmbed({ rollback_version: 'previous release' }, { local: true }).toJSON().description.includes('retained legacy version'), true);
  const malformedRetained = botRollbackOptionsRows({ ...snapshot.bot, rollback_source: 'local', rollback_version: 'previous release' })
    .flatMap((row) => row.toJSON().components);
  assert.equal(malformedRetained.find((component) => component.custom_id === 'updates:bot-rollback-retained').label, 'Rollback to retained legacy version');
  const loading = botReleaseLoadingEmbed('update', { phase: 'downloading', latest: '0.3.18', events: [{ message: 'Downloading the verified GitHub release archive' }] }, 2).toJSON();
  assert.match(loading.description, /Downloading the release archive/);
  assert.match(loading.description, /both control containers answer their health checks/);
  assert.match(loading.fields[0].value, /verified GitHub release archive/);
  const restarting = botReleaseRestartEmbed('update', { phase: 'restarting', requested_version: '0.3.18' }).toJSON();
  assert.match(restarting.title, /restarting/i);
  assert.match(restarting.description, /short period of silence is expected/i);
  assert.match(restarting.description, /several minutes/i);
  assert.match(restarting.description, /Update complete/i);
  const confirmation = botUpdateConfirmationEmbed({ latest: '0.3.18', release_notes: '## Changes\n- Restart completion\n- @everyone stays silent' }).toJSON();
  assert.match(confirmation.fields[0].value, /Restart completion/);
  assert.doesNotMatch(confirmation.fields[0].value, /@everyone/);
  assert.ok(confirmation.fields[0].value.length <= 1024);
  const result = botReleaseResultEmbed('update', { phase: 'complete', current: '0.3.18', previous_version: '0.3.17', detail: 'Release 0.3.18 is running and both control health checks passed', events: [{ message: 'Bot release applied and verified' }] }).toJSON();
  assert.match(result.description, /Bot update verified/);
  assert.match(result.description, /0\.3\.18/);
  assert.match(result.fields[0].value, /Bot release applied and verified/);
  const rollback = botReleaseResultEmbed('rollback', { phase: 'rolled_back', current: '0.3.16', previous_version: '0.3.17', rollback_source: 'github', detail: 'Release 0.3.16 is running and both control health checks passed', events: [{ message: 'Previous bot release restored and verified' }] }).toJSON();
  assert.match(rollback.description, /Previous bot release restored/);
  assert.match(rollback.description, /GitHub archive/);
  assert.match(rollback.footer.text, /control containers restored and verified/);
  const refused = botReleaseResultEmbed('update', {
    phase: 'failed',
    current: '0.4.0',
    detail: 'The release version is not a valid semantic version',
    containers_changed: false,
    restored: false,
    events: [{ message: 'Bot release was refused before changing containers' }],
  }).toJSON();
  assert.match(refused.footer.text, /no containers changed/);
  assert.doesNotMatch(refused.footer.text, /verified/i);
});

test('settings controls keep the detected catalogue and return to settings', () => {
  const rows = settingsRows({}, 'controls', {
    mode: 'opt-out',
    mode_description: 'Detected containers are controllable unless excluded.',
    services: [{ key: 'jellyfin', label: 'Jellyfin', state: 'running', manageable: true, enabled: true }],
  }).map((row) => row.toJSON());
  assert.equal(rows[0].components[1].custom_id, 'nav:settings');
  assert.ok(rows.flatMap((row) => row.components).some((component) => component.custom_id === 'settings-control:select:1:1'));
});

test('beta settings explain and gate the live-patch auto-update route', () => {
  const locked = settingsEmbed({ releaseChannel: 'beta', autoUpdateMode: 'daily', betaAutoUpdateConfirmed: false }, {}, null, 'updates').toJSON();
  assert.match(locked.fields.find((field) => field.name.includes('Beta live-patch')).value, /locked until an administrator acknowledges/i);
  const lockedRows = settingsRows({ releaseChannel: 'beta', autoUpdateMode: 'daily', betaAutoUpdateConfirmed: false }, 'updates').flatMap((row) => row.toJSON().components);
  assert.equal(lockedRows.find((component) => component.custom_id === 'settings:auto-mode').placeholder, 'Automatic updates · locked');
  assert.ok(lockedRows.some((component) => component.custom_id === 'settings:beta-acknowledge'));

  const acknowledged = settingsEmbed({ releaseChannel: 'beta', autoUpdateMode: 'daily', betaAutoUpdateConfirmed: true }, {}, null, 'updates').toJSON();
  assert.match(acknowledged.fields.find((field) => field.name.includes('Beta live-patch')).value, /automatic updates are allowed/i);
  const acknowledgedRows = settingsRows({ releaseChannel: 'beta', autoUpdateMode: 'daily', betaAutoUpdateConfirmed: true }, 'updates').flatMap((row) => row.toJSON().components);
  assert.ok(acknowledgedRows.some((component) => component.custom_id === 'settings:beta-revoke'));
});

test('update settings use channel names and explain that schedules install', () => {
  const embed = settingsEmbed({ releaseChannel: 'stable', autoUpdateMode: 'weekly', autoUpdateHour: 4 }, {}, null, 'updates').toJSON();
  assert.match(embed.fields.find((field) => field.name === 'Release channel').value, /Stable channel/);
  assert.match(embed.fields.find((field) => field.name === 'Automatic updates').value, /Checks and installs stable releases weekly/i);

  const rows = settingsRows({ releaseChannel: 'stable', autoUpdateMode: 'daily', autoUpdateHour: 4 }, 'updates')
    .flatMap((row) => row.toJSON().components);
  const modeMenu = rows.find((component) => component.custom_id === 'settings:auto-mode');
  assert.equal(modeMenu.placeholder, 'Automatic updates · Daily checks · 04:00');
  assert.deepEqual(modeMenu.options.map((option) => option.label), [
    'Off · manual updates',
    'Daily hotfixes · recommended',
    'Daily checks',
    'Weekly checks',
  ]);
  assert.ok(modeMenu.options.every((option) => option.description.includes('install') || option.value === 'off'));
  assert.equal(rows.find((component) => component.custom_id === 'settings:release-channel').options[0].label, 'Stable channel');
});

test('Ubuntu maintenance UI reports pending security work and guarded actions', () => {
  const system = {
    available: true,
    os: { id: 'ubuntu', name: 'Ubuntu', pretty_name: 'Ubuntu Server 24.04.4 LTS' },
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

test('maintenance loading UI does not assume Ubuntu when host identity is unavailable', () => {
  const embed = systemUpdateLoadingEmbed({ phase: 'queued' }, 0).toJSON();
  assert.match(embed.title, /^Host \/\//);
  assert.doesNotMatch(embed.title, /Ubuntu/i);
});

test('Ubuntu update summary explains security classification and phasing', () => {
  const summary = hostUpdateSummary({
    available: true,
    os: { id: 'ubuntu', name: 'Ubuntu', pretty_name: 'Ubuntu Server 24.04.4 LTS' },
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
  assert.match(embed.footer.text, /lifecycle controls.*\/settings/i);
});

test('host restart hand-off has an honest waiting state and explicit post-boot completion', () => {
  const waiting = hostRestartWaitingEmbed({ phase: 'rebooting', os: sampleStatus.os }).toJSON();
  assert.match(waiting.title, /Ubuntu/);
  assert.match(waiting.description, /Restarting the host/);
  assert.match(waiting.description, /new boot/);
  const result = hostRestartResultEmbed({ phase: 'online', os: sampleStatus.os, online_at: new Date().toISOString(), events: [{ message: 'The host is back online after the confirmed restart' }] }).toJSON();
  assert.match(result.description, /Restarted successfully/);
  assert.match(result.footer.text, /post-boot status verified/);
});

test('bot maintenance hand-off reports the selected recovery action after restart', () => {
  const loading = botMaintenanceLoadingEmbed('reset', { phase: 'checking', events: [{ message: 'Private backup created' }] }, 1).toJSON();
  assert.match(loading.title, /Resetting Homelab Control settings/);
  assert.match(loading.description, /private backup/);
  assert.match(loading.fields[0].value, /Private backup/);
  const waiting = botMaintenanceRestartEmbed('restart').toJSON();
  assert.match(waiting.description, /recreated/);
  assert.match(waiting.description, /Bot restart verified/);
  const result = botMaintenanceResultEmbed('restore', { phase: 'complete', current_version: '0.4.0', detail: 'Previous settings backup restored', events: [{ message: 'Control recovery completed and verified' }] }).toJSON();
  assert.match(result.description, /Settings restore complete/);
  assert.match(result.description, /0\.4\.0/);
});

test('settings controls category keeps the detected catalogue instead of rendering an empty selector', () => {
  const rows = settingsRows({}, 'controls', {
    mode: 'opt-out',
    services: [{ key: 'jellyfin', label: 'Jellyfin', state: 'running', health: 'healthy', manageable: true, enabled: true }],
  }).map((row) => row.toJSON());
  assert.ok(rows.flatMap((row) => row.components).some((component) => component.custom_id === 'settings-control:select:1:1'));
  assert.equal(rows[0].components[1].custom_id, 'nav:settings');
});
