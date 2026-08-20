import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-doc-amount-'));
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

test('prihod line amount is persisted and price is derived from amount', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const product = svc.createProduct({
    name: 'Рибай',
    sku: 'AMT-001',
    unit: 'шт',
    price: 145999.99,
    branch_id: 'main',
  });

  const created = svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 5, price: 145999.99 }],
    status: 'draft',
  }, 'test-user', 'main');

  assert.equal(created.items[0].amount, 729999.95);

  const updated = svc.updateDocument(created.id, {
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{
      product_id: product.id,
      quantity: 3,
      price: 333333.33,
      amount: 1000000,
    }],
    status: 'draft',
  }, 'test-user', 'main');

  assert.equal(updated.items.length, 1);
  assert.equal(updated.items[0].amount, 1000000);
  assert.equal(updated.total_amount, 1000000);
  assert.ok(Math.abs(updated.items[0].price - (1000000 / 3)) < 1e-9);

  const withoutAmount = svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 2, price: 1500.5 }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(withoutAmount.items[0].amount, 3001);
});
