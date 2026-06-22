import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'http';

let testDir;
let server;
let baseUrl;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-native-auth-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';

  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const { createApp } = await import('../app.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const app = createApp();
  await new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('native login returns bearer token for background API calls', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Native-Client': '1',
    },
    body: JSON.stringify({ username: 'admin', password: 'admin123', native: true }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token);
  assert.equal(data.user.username, 'admin');

  const locRes = await fetch(`${baseUrl}/api/staff/location`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.token}`,
    },
    body: JSON.stringify({ latitude: 41.31, longitude: 69.28, accuracy: 10, source: 'android_bg' }),
  });
  assert.equal(locRes.status, 200);
  const saved = await locRes.json();
  assert.equal(saved.source, 'android_bg');
});
