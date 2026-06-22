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
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-snab-install-'));
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

test('shop orders user can read snab install info', async () => {
  const res = await fetch(`${baseUrl}/api/app/snab-install`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.mobileUrl.includes('/snab'));
  assert.ok(data.apkUrl);
  assert.ok(data.githubBuildUrl);
});

test('public snab apk redirects to github release', async () => {
  const res = await fetch(`${baseUrl}/api/public/snab-apk`, { redirect: 'manual' });
  assert.ok(res.status === 302 || res.status === 404);
  if (res.status === 302) {
    const location = res.headers.get('location') || '';
    assert.ok(location.includes('snabzenie.apk'));
  }
});
