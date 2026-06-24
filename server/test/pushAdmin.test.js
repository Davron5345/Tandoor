import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'http';
import webpush from 'web-push';

let testDir;
let server;
let baseUrl;
let adminCookie;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-push-admin-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';
  const vapid = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';

  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const { createApp } = await import('../app.js');
  const { initWebPush } = await import('../push.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();
  initWebPush();

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

test('snab update info returns version metadata', async () => {
  const res = await fetch(`${baseUrl}/api/app/snab-update`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.versionCode >= 1);
  assert.ok(data.apkUrl);
  assert.equal(data.webAutoUpdate, true);
});

test('admin can list push subscribers', async () => {
  const res = await fetch(`${baseUrl}/api/admin/push/subscribers`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.items));
  assert.equal(typeof data.total, 'number');
});

test('admin push send validates title and body', async () => {
  const res = await fetch(`${baseUrl}/api/admin/push/send`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '', body: '' }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test('admin push send with no subscribers returns zero sent', async () => {
  const res = await fetch(`${baseUrl}/api/admin/push/send`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Тест', body: 'Сообщение', url: '/snab' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.sent, 0);
  assert.equal(data.total, 0);
});
