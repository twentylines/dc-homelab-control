import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('optional config file fills blank deployment fields without overriding explicit values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'homelab-control-config-'));
  const file = join(directory, 'config.env');
  writeFileSync(file, [
    'CONTROL_TOKEN=file-token-that-is-long-enough-0123456789',
    'DISCORD_TOKEN=file-discord-token',
    'DISCORD_CLIENT_ID=123456789012345678',
    'DISCORD_GUILD_ID=234567890123456789',
    'DISCORD_OWNER_ID=345678901234567890',
    'BOT_NAME=File configured bot',
  ].join('\n'));
  const script = [
    "import { config } from './src/config.js';",
    "console.log(JSON.stringify({ token: config.controlToken, discord: config.discordToken, guild: config.guildId, bot: config.botName }));",
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOMELAB_CONTROL_CONFIG_FILE: file,
      CONTROL_TOKEN: 'explicit-token-that-is-long-enough-0123456789',
      DISCORD_TOKEN: '',
      DISCORD_CLIENT_ID: '',
      DISCORD_GUILD_ID: '',
      DISCORD_OWNER_ID: '',
      DISCORD_APPLICATION_ID: '',
    },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.token, 'explicit-token-that-is-long-enough-0123456789');
    assert.equal(output.discord, 'file-discord-token');
    assert.equal(output.guild, '234567890123456789');
    assert.equal(output.bot, 'File configured bot');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
