import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyInternals } from '../src/weekly.js';
import { settingsInternals } from '../src/settings.js';

test('release parsing recognises compact letter hotfixes', () => {
  assert.deepEqual(weeklyInternals.releaseParts('v0.4.0B'), { major: 0, minor: 4, patch: 0, suffix: 'b' });
  assert.equal(weeklyInternals.isHotfixVersion('0.4.0b'), true);
  assert.equal(weeklyInternals.isHotfixVersion('0.4.0'), false);
});

test('automatic release modes keep hotfix and weekly policies narrow', () => {
  const base = { update_available: true, asset_verified: true, update_supported: true, current: '0.4.0', channel: 'stable' };
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, latest: '0.4.0a' }, 'hotfix'), true);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, latest: '0.4.0b' }, 'hotfix'), true);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, current: '0.4.0a', latest: '0.4.0b' }, 'hotfix'), true);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, current: '0.4.0b', latest: '0.4.0a' }, 'hotfix'), false);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, latest: '0.5.0' }, 'weekly', { weekday: 'Sun' }), true);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, latest: '0.4.1' }, 'weekly', { weekday: 'Sun' }), true);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, latest: '0.4.1' }, 'weekly', { weekday: 'Mon' }), false);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, latest: '0.4.0a' }, 'weekly', { weekday: 'Mon' }), true);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, latest: '0.4.1' }, 'daily'), true);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...base, channel: 'beta', latest: '0.5.0' }, 'weekly', { weekday: 'Sun' }), true);
});

test('compact a hotfix tags are parsed and ordered after the stable patch', () => {
  assert.deepEqual(weeklyInternals.releaseParts('v0.4.0A'), {
    major: 0,
    minor: 4,
    patch: 0,
    suffix: 'a',
  });
  assert.equal(weeklyInternals.compareReleaseVersions('0.4.0a', '0.4.0'), 1);
  assert.equal(weeklyInternals.compareReleaseVersions('0.4.0b', '0.4.0a'), 1);
});

test('beta channel can be checked daily without widening weekly automation', () => {
  const beta = {
    update_available: true,
    asset_verified: true,
    update_supported: true,
    current: '0.4.0',
    channel: 'beta',
  };
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...beta, latest: '0.5.0-rc.1' }, 'daily'), true);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...beta, latest: '0.4.0c' }, 'hotfix'), true);
  assert.equal(weeklyInternals.autoReleaseAllowed({ ...beta, latest: '0.5.0-rc.1' }, 'weekly'), false);
});

test('beta automatic updates require an explicit live-patch acknowledgement', () => {
  assert.equal(weeklyInternals.betaAutoUpdateAllowed({ releaseChannel: 'stable', betaAutoUpdateConfirmed: false }), true);
  assert.equal(weeklyInternals.betaAutoUpdateAllowed({ releaseChannel: 'beta', betaAutoUpdateConfirmed: false }), false);
  assert.equal(weeklyInternals.betaAutoUpdateAllowed({ releaseChannel: 'beta', betaAutoUpdateConfirmed: true }), true);
});

test('automatic schedules use the configured local hour and a bounded window', () => {
  const atFour = { hour: '04', minute: '09', weekday: 'Mon' };
  assert.equal(weeklyInternals.isAutoWindow(atFour, 'daily', 4), true);
  assert.equal(weeklyInternals.isAutoWindow({ ...atFour, minute: '10' }, 'daily', 4), false);
  assert.equal(weeklyInternals.isAutoWindow({ ...atFour, weekday: 'Sun' }, 'weekly', 4), true);
  assert.equal(weeklyInternals.isAutoWindow(atFour, 'weekly', 4), true);
  assert.equal(weeklyInternals.isAutoWindow(atFour, 'off', 4), false);
});

test('settings deny lists keep removed environment identities disabled after restart', () => {
  const admin = '123456789012345';
  const guest = '234567890123456';
  const state = settingsInternals.normalise({
    adminUserIds: [admin],
    guestUserIds: [guest],
    disabledAdminUserIds: [admin],
    disabledGuestUserIds: [guest],
  });
  assert.deepEqual(state.adminUserIds, []);
  assert.deepEqual(state.guestUserIds, []);
  assert.deepEqual(state.disabledAdminUserIds, [admin]);
  assert.deepEqual(state.disabledGuestUserIds, [guest]);
});

test('settings keep the owner visible and merge runtime identities with configured defaults', () => {
  const owner = process.env.DISCORD_OWNER_ID;
  const extra = '987654321098765';
  const state = settingsInternals.normalise({ superuserIds: [extra] });
  assert.ok(state.superuserIds.includes(owner));
  assert.ok(state.superuserIds.includes(extra));

  const protectedState = settingsInternals.normalise({
    superuserIds: [extra],
    disabledSuperuserIds: [owner, extra],
  });
  assert.ok(protectedState.superuserIds.includes(owner));
  assert.equal(protectedState.superuserIds.includes(extra), false);
  assert.deepEqual(protectedState.disabledSuperuserIds, [extra]);
});

test('settings require a real boolean before beta automatic updates are acknowledged', () => {
  assert.equal(settingsInternals.normalise({ releaseChannel: 'beta' }).betaAutoUpdateConfirmed, false);
  assert.equal(settingsInternals.normalise({ releaseChannel: 'beta', betaAutoUpdateConfirmed: 'true' }).betaAutoUpdateConfirmed, false);
  assert.equal(settingsInternals.normalise({ releaseChannel: 'beta', betaAutoUpdateConfirmed: true }).betaAutoUpdateConfirmed, true);
});
