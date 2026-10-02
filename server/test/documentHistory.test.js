import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-doc-history-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';
});

after(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('document history shows who changed what: before → after', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const admin = db.queryOne("SELECT id, name FROM users WHERE username = 'admin'");
  const deptId = getDefaultDepartmentId('main');
  const meat = svc.createProduct({ name: 'Мол', sku: 'HIS-001', unit: 'кг', price: 1000, branch_id: 'main' });
  const salt = svc.createProduct({ name: 'Соль', sku: 'HIS-002', unit: 'кг', price: 10, branch_id: 'main' });
  const oil = svc.createProduct({ name: 'Масло', sku: 'HIS-003', unit: 'л', price: 50, branch_id: 'main' });

  const doc = svc.createDocument({
    type: 'prihod',
    date: '2026-09-08',
    to_department_id: deptId,
    comment: 'черновик',
    items: [
      { product_id: meat.id, quantity: 20, price: 18000 },
      { product_id: salt.id, quantity: 5, price: 100 },
    ],
    status: 'draft',
  }, admin.id, 'main');

  svc.updateDocument(doc.id, {
    type: 'prihod',
    date: '2026-09-09',
    to_department_id: deptId,
    comment: 'исправлено',
    items: [
      { product_id: meat.id, quantity: 32.5, price: 18000 },
      { product_id: oil.id, quantity: 2, price: 500 },
    ],
    status: 'draft',
  }, admin.id, 'main');

  svc.confirmDocument(doc.id, admin.id);

  const history = svc.getDocumentHistory(doc.id);
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((h) => h.action), ['confirmed', 'updated', 'created']);
  assert.ok(history.every((h) => h.user_name === admin.name));
  assert.ok(history.every((h) => !('snapshot' in h)));

  const [confirmed, updated, created] = history;

  assert.equal(created.is_initial, true);
  assert.equal(created.changes.items.added.length, 2);

  const fieldsByKey = Object.fromEntries(updated.changes.fields.map((f) => [f.key, f]));
  assert.equal(fieldsByKey.date.before, '2026-09-08');
  assert.equal(fieldsByKey.date.after, '2026-09-09');
  assert.equal(fieldsByKey.comment.before, 'черновик');
  assert.equal(fieldsByKey.comment.after, 'исправлено');
  assert.equal(fieldsByKey.total_amount.before, 360500);
  assert.equal(fieldsByKey.total_amount.after, 586000);

  const { added, removed, changed } = updated.changes.items;
  assert.deepEqual(added.map((i) => i.name), ['Масло']);
  assert.deepEqual(removed.map((i) => i.name), ['Соль']);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].name, 'Мол');
  const qty = changed[0].fields.find((f) => f.label === 'Кол-во');
  assert.equal(qty.before, 20);
  assert.equal(qty.after, 32.5);

  const status = confirmed.changes.fields.find((f) => f.key === 'status');
  assert.equal(status.before, 'Черновик');
  assert.equal(status.after, 'Проведён');
  assert.equal(confirmed.changes.items, null);
});
