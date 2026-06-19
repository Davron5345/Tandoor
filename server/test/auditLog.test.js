import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-audit-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
});

after(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('getAuditLog filters and paginates entries', async () => {
  const { initDb } = await import('../db.js');
  const { logAudit, getAuditLog } = await import('../auditLog.js');

  await initDb();

  const req = {
    user: { id: 'u1', username: 'admin' },
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  };

  logAudit(req, 'auth.login', { meta: { client: 'web' } });
  logAudit(req, 'document.confirm', {
    entity_type: 'document',
    entity_id: 'doc-123',
    meta: { type: 'prihod', number: 'P-001' },
  });

  const all = getAuditLog({ page: 1, limit: 50 });
  assert.equal(all.total, 2);
  assert.equal(all.items.length, 2);
  const actions = all.items.map((row) => row.action);
  assert.ok(actions.includes('auth.login'));
  assert.ok(actions.includes('document.confirm'));

  const filtered = getAuditLog({ action: 'auth.login', page: 1, limit: 50 });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].action, 'auth.login');
  assert.equal(filtered.items[0].username, 'admin');

  const byUser = getAuditLog({ username: 'adm', page: 1, limit: 50 });
  assert.equal(byUser.total, 2);

  const page = getAuditLog({ page: 1, limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.pages, 2);
});
