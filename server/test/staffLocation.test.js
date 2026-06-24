import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'http';

let testDir;
let server;
let baseUrl;
let adminCookie;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-staff-loc-'));
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

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0];
});

after(() => {
  if (server) server.close();
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('staff can send location and admin can list it', async () => {
  const res = await fetch(`${baseUrl}/api/staff/location`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: 41.3111, longitude: 69.2797, accuracy: 12 }),
  });
  assert.equal(res.status, 200);
  const saved = await res.json();
  assert.equal(saved.latitude, 41.3111);

  const listRes = await fetch(`${baseUrl}/api/admin/staff-locations`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.ok(list.some((row) => row.username === 'admin'));

  const historyRes = await fetch(
    `${baseUrl}/api/admin/staff-locations/history?user_id=${encodeURIComponent(saved.user_id)}`,
    { headers: { cookie: adminCookie } },
  );
  assert.equal(historyRes.status, 200);
  const history = await historyRes.json();
  assert.ok(history.points.length >= 1);
  assert.equal(history.points[0].latitude, 41.3111);
});
