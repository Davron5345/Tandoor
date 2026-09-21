import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'http';
import { SESSION_COOKIE } from '../sessionCookie.js';

let testDir;
let server;
let baseUrl;
let cookie;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-login-link-'));
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
  cookie = await adminCookie();
});

after(() => {
  if (server) server.close();
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

async function adminCookie() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

test('employee gets unique phone login link and lands on role home', async () => {
  const created = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      username: 'cook1',
      password: 'CookPass1',
      name: 'Повар цеха',
      role: 'warehouse',
      branch_id: 'main',
      department_id: 'main_wh',
      active: true,
    }),
  });
  const user = await created.json();
  assert.equal(created.status, 201, JSON.stringify(user));
  assert.ok(user.login_path?.startsWith('/e/'));
  assert.equal(user.department_id, 'main_wh');

  const token = user.login_path.slice(3);
  const loginRes = await fetch(`${baseUrl}/api/auth/login-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const loginBody = await loginRes.json();
  assert.equal(loginRes.status, 200, JSON.stringify(loginBody));
  assert.equal(loginBody.user.username, 'cook1');
  assert.equal(loginBody.home, '/warehouse/orders');
  assert.equal(loginBody.token, undefined);

  const setCookie = loginRes.headers.get('set-cookie') || '';
  assert.match(setCookie, new RegExp(`${SESSION_COOKIE}=`));
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: setCookie.split(';')[0] },
  });
  assert.equal(meRes.status, 200);
  const me = await meRes.json();
  assert.equal(me.username, 'cook1');
  assert.equal(me.department_id, 'main_wh');
});

test('cashier phone link opens cashier home', async () => {
  const created = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      username: 'kassa-link',
      password: 'KassaPass1',
      name: 'Кассир зала',
      role: 'cashier',
      branch_id: 'main',
      active: true,
    }),
  });
  const user = await created.json();
  assert.equal(created.status, 201, JSON.stringify(user));
  const token = user.login_path.slice(3);
  const loginRes = await fetch(`${baseUrl}/api/auth/login-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const body = await loginRes.json();
  assert.equal(loginRes.status, 200, JSON.stringify(body));
  assert.equal(body.home, '/cashier');
});

test('rotating login link invalidates the old token', async () => {
  const created = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      username: 'rotate-link',
      password: 'RotatePass1',
      name: 'Смена ссылки',
      role: 'cashier',
      branch_id: 'main',
      active: true,
    }),
  });
  const user = await created.json();
  assert.equal(created.status, 201, JSON.stringify(user));
  const oldToken = user.login_path.slice(3);

  const rotated = await fetch(`${baseUrl}/api/users/${user.id}/login-link`, {
    method: 'POST',
    headers: { cookie },
  });
  const next = await rotated.json();
  assert.equal(rotated.status, 200, JSON.stringify(next));
  assert.ok(next.login_path);
  assert.notEqual(next.login_path, user.login_path);

  const oldLogin = await fetch(`${baseUrl}/api/auth/login-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: oldToken }),
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await fetch(`${baseUrl}/api/auth/login-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: next.login_path.slice(3) }),
  });
  assert.equal(newLogin.status, 200);
});

test('invalid login link is rejected', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'not-a-real-login-token-xx' }),
  });
  assert.equal(res.status, 401);
});

test('inactive employee cannot enter by link', async () => {
  const created = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      username: 'off-link',
      password: 'OffPass12',
      name: 'Отключён',
      role: 'cashier',
      branch_id: 'main',
      active: true,
    }),
  });
  const user = await created.json();
  assert.equal(created.status, 201, JSON.stringify(user));
  const token = user.login_path.slice(3);

  const off = await fetch(`${baseUrl}/api/users/${user.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ active: false }),
  });
  const offBody = await off.json();
  assert.equal(off.status, 200, JSON.stringify(offBody));

  const loginRes = await fetch(`${baseUrl}/api/auth/login-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  assert.equal(loginRes.status, 401);
});

test('payroll link without login opens cabinet only', async () => {
  const { importPayrollEmployees } = await import('../services/faceidPayroll.js');
  const imported = importPayrollEmployees('main', [{
    full_name: 'Без Логина',
    department: 'Кухня',
    position: 'Повар',
    active: true,
  }]);
  assert.equal(imported.created, 1);
  const { listPayrollEmployees } = await import('../services/faceidPayroll.js');
  const emp = listPayrollEmployees('main').items.find((e) => e.full_name === 'Без Логина');
  assert.ok(emp?.view_path?.startsWith('/e/'));
  assert.equal(emp.has_login, false);

  const res = await fetch(`${baseUrl}/api/auth/login-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: emp.view_path.slice(3) }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.mode, 'cabinet');
  assert.equal(body.cabinet.full_name, 'Без Логина');
  assert.equal(body.user, undefined);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('payroll link with system login enters the app', async () => {
  const { importPayrollEmployees, listPayrollEmployees } = await import('../services/faceidPayroll.js');
  importPayrollEmployees('main', [{
    full_name: 'С Логином',
    department: 'Касса',
    position: 'Кассир',
    active: true,
  }]);
  const emp = listPayrollEmployees('main').items.find((e) => e.full_name === 'С Логином');
  const created = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      username: 'withlogin',
      password: 'WithPass12',
      name: 'С Логином',
      role: 'cashier',
      branch_id: 'main',
      payroll_employee_id: emp.id,
      active: true,
    }),
  });
  const user = await created.json();
  assert.equal(created.status, 201, JSON.stringify(user));
  assert.equal(user.login_path, emp.view_path);

  const res = await fetch(`${baseUrl}/api/auth/login-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: emp.view_path.slice(3) }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.mode, 'app');
  assert.equal(body.user.username, 'withlogin');
  assert.equal(body.home, '/cashier');
});
