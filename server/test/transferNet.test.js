import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-transfer-net-'));
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

test('transfer with net_weight moves net × qty between departments', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { createDepartment, getDefaultDepartmentId, getDepartmentStock } = await import('../departments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const fromDept = getDefaultDepartmentId('main');
  const toDept = createDepartment({ branch_id: 'main', name: 'Цех' }).id;
  assert.ok(fromDept && toDept && fromDept !== toDept);

  const product = svc.createProduct({
    name: 'Масло',
    sku: 'NET-TR-001',
    unit: 'кг',
    price: 10000,
    net_weight: 0.5,
    branch_id: 'main',
  });

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: fromDept,
    items: [{ product_id: product.id, quantity: 10, price: 10000, net_weight: 0.5 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(getDepartmentStock(product.id, fromDept), 5);

  const transfer = svc.createDocument({
    type: 'peremeshchenie',
    date: '2026-08-20',
    from_branch_id: 'main',
    to_branch_id: 'main',
    from_department_id: fromDept,
    to_department_id: toDept,
    items: [{ product_id: product.id, quantity: 4, price: 0, net_weight: 0.5 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(transfer.status, 'confirmed');
  assert.equal(getDepartmentStock(product.id, fromDept), 3);
  assert.equal(getDepartmentStock(product.id, toDept), 2);

  assert.throws(
    () => svc.createDocument({
      type: 'peremeshchenie',
      date: '2026-08-20',
      from_branch_id: 'main',
      to_branch_id: 'main',
      from_department_id: fromDept,
      to_department_id: toDept,
      items: [{ product_id: product.id, quantity: 10, price: 0, net_weight: 0.5 }],
      status: 'confirmed',
    }, 'test-user', 'main'),
    /Недостаточно остатка/,
  );
});
