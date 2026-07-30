import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-product-docs-'));
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

test('getDocuments product_id filter returns matching prihod line qty/price', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  assert.ok(deptId);

  const productA = svc.createProduct({
    name: 'Товар A',
    sku: 'PA-001',
    unit: 'шт',
    price: 1000,
    branch_id: 'main',
  });
  const productB = svc.createProduct({
    name: 'Товар B',
    sku: 'PB-001',
    unit: 'шт',
    price: 2000,
    branch_id: 'main',
  });

  const doc = svc.createDocument({
    type: 'prihod',
    date: '2026-07-30',
    to_department_id: deptId,
    items: [
      { product_id: productA.id, quantity: 3, price: 1500 },
      { product_id: productB.id, quantity: 7, price: 2500 },
    ],
    status: 'draft',
  }, 'test-user', 'main');

  svc.confirmDocument(doc.id, 'test-user');

  const rows = svc.getDocuments({
    branch_id: 'main',
    type: 'prihod',
    status: 'confirmed',
    product_id: productA.id,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, doc.id);
  assert.equal(Number(rows[0].quantity), 3);
  assert.equal(Number(rows[0].price), 1500);
  assert.equal(Number(rows[0].amount), 4500);

  const none = svc.getDocuments({
    branch_id: 'main',
    type: 'prihod',
    status: 'confirmed',
    product_id: 'missing-product',
  });
  assert.equal(none.length, 0);
});
