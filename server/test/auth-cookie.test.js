import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'http';
import { SESSION_COOKIE, parseCookies } from '../sessionCookie.js';

let testDir;
let server;
let baseUrl;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-auth-cookie-'));
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
});

after(() => {
  if (server) server.close();
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('login sets HttpOnly session cookie and hides token from body', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', remember: true }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.user?.username === 'admin');
  assert.equal(body.token, undefined);

  const setCookie = res.headers.get('set-cookie') || '';
  assert.match(setCookie, new RegExp(`${SESSION_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Max-Age=/i);

  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: setCookie.split(';')[0] },
  });
  assert.equal(meRes.status, 200);
  const me = await meRes.json();
  assert.equal(me.username, 'admin');
});

test('login without remember uses session cookie without Max-Age', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', remember: false }),
  });

  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  assert.match(setCookie, new RegExp(`${SESSION_COOKIE}=`));
  assert.doesNotMatch(setCookie, /Max-Age=/i);
});

test('logout clears session cookie', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(logoutRes.status, 200);

  const cleared = logoutRes.headers.get('set-cookie') || '';
  assert.match(cleared, /Max-Age=0/i);

  const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
  assert.equal(meRes.status, 401);
});

test('parseCookies reads session cookie value', () => {
  const req = { headers: { cookie: `${SESSION_COOKIE}=abc-123; other=1` } };
  assert.equal(parseCookies(req)[SESSION_COOKIE], 'abc-123');
});
