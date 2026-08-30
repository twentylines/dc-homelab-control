import test from 'node:test';
import assert from 'node:assert/strict';
import { minecraftInternals } from '../src/minecraft.js';

test('Pterodactyl-compatible discovery uses canonical client routes and resources', async () => {
  const requests = [];
  const request = async (baseUrl, path, token) => {
    requests.push({ baseUrl, path, token });
    if (path === '/api/client') return {
      object: 'list',
      data: [{ attributes: { identifier: 'abc123', name: 'Survival', image: 'java:21', limits: { memory: 4096, cpu: 200 } } }],
    };
    if (path === '/api/client/servers/abc123/resources') return {
      object: 'stats',
      attributes: {
        current_state: 'running',
        resources: { cpu_absolute: 12.5, memory_bytes: 734003200, disk_bytes: 4096, pids: 18 },
      },
    };
    throw new Error(`unexpected path ${path}`);
  };
  const servers = await minecraftInternals.pterodactylServers('https://panel.example.test', 'test-client-token', 'pterodactyl', request);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].id, 'abc123');
  assert.equal(servers[0].running, true);
  assert.equal(servers[0].resources.cpu_percent, 12.5);
  assert.equal(servers[0].resources.memory_used, 734003200);
  assert.equal(servers[0].resources.pids, 18);
  assert.deepEqual(requests.map((item) => item.path), ['/api/client', '/api/client/servers/abc123/resources']);
  assert.ok(requests.every((item) => item.baseUrl === 'https://panel.example.test' && item.token === 'test-client-token'));
});

test('large Minecraft panels keep the full server list while bounding resource sampling', async () => {
  const resourcePaths = [];
  const list = Array.from({ length: 34 }, (_, index) => ({
    attributes: { identifier: `server-${index}`, name: `Server ${index}`, image: 'java:21' },
  }));
  const request = async (_baseUrl, path) => {
    if (path === '/api/client') return { data: list };
    resourcePaths.push(path);
    return { attributes: { current_state: 'offline', resources: { memory_bytes: 0 } } };
  };
  const servers = await minecraftInternals.pterodactylServers('https://panel.example.test', 'token', 'pterodactyl', request);
  assert.equal(servers.length, 34);
  assert.equal(resourcePaths.length, 32);
  assert.equal(servers[32].state, 'unknown');
  assert.match(servers[32].resource_error, /32-server safety limit/);
});
