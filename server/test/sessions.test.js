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
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-sessions-'));
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
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
    },
    body: JSON.stringify({ username: 'admin', password: 'admin123', remember: true }),
  });
  adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(adminCookie);
});

after(() => {
  if (server) server.close();
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('admin can list active sessions with device info', async () => {
  const res = await fetch(`${baseUrl}/api/admin/sessions`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.items.length >= 1);
  const session = data.items[0];
  assert.ok(session.device_label);
  assert.ok(session.device_id);
  assert.ok(session.ip);
});

test('login failure is recorded in visit log', async () => {
  await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
  });

  const res = await fetch(`${baseUrl}/api/admin/visits?action=auth.login_failed&limit=5`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.items.some((row) => row.action === 'auth.login_failed'));
});

test('admin can block device from session and login is rejected', async () => {
  const skladLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/121.0 BlockTest',
    },
    body: JSON.stringify({ username: 'sklad', password: 'sklad123' }),
  });
  assert.equal(skladLogin.status, 200);

  const sessionsRes = await fetch(`${baseUrl}/api/admin/sessions?username=sklad`, {
    headers: { cookie: adminCookie },
  });
  const sessions = await sessionsRes.json();
  const target = sessions.items.find((s) => s.username === 'sklad');
  assert.ok(target?.device_id);

  const blockRes = await fetch(`${baseUrl}/api/admin/sessions/${target.id}/block-device`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'test block' }),
  });
  assert.equal(blockRes.status, 201);

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/121.0 BlockTest',
    },
    body: JSON.stringify({ username: 'sklad', password: 'sklad123' }),
  });
  assert.equal(loginRes.status, 403);

  const visitsRes = await fetch(`${baseUrl}/api/admin/visits?action=auth.login_blocked&limit=10`, {
    headers: { cookie: adminCookie },
  });
  const visits = await visitsRes.json();
  assert.ok(visits.items.some((row) => row.action === 'auth.login_blocked'));
});

test('non-admin cannot access sessions admin api', async () => {
  const skladLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (iPhone) Safari/604.1',
    },
    body: JSON.stringify({ username: 'sklad', password: 'sklad123' }),
  });
  const skladCookie = skladLogin.headers.get('set-cookie')?.split(';')[0];

  const res = await fetch(`${baseUrl}/api/admin/sessions`, {
    headers: { cookie: skladCookie },
  });
  assert.equal(res.status, 403);
});
