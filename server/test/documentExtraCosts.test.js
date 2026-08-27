import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-doc-extra-'));
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

test('prihod extra costs: capitalize by stock qty, skip period, reverse on cancel', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const { getDepartmentStockWithCost } = await import('../inventoryCost.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const productA = svc.createProduct({
    name: 'A',
    sku: 'EX-A',
    unit: 'кг',
    price: 5000,
    net_weight: 0.5,
    branch_id: 'main',
  });
  const productB = svc.createProduct({
    name: 'B',
    sku: 'EX-B',
    unit: 'кг',
    price: 10000,
    net_weight: 1,
    branch_id: 'main',
  });

  const cap = svc.createDocument({
    type: 'prihod',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [
      { product_id: productA.id, quantity: 2, price: 5000, amount: 10000, net_weight: 0.5 },
      { product_id: productB.id, quantity: 2, price: 10000, amount: 20000, net_weight: 1 },
    ],
    extra_costs: [{ title: 'Дорога', amount: 3000, capitalize: true }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(cap.total_amount, 30000);
  assert.equal(cap.extra_costs_total, 3000);
  assert.equal(cap.capitalized_extra_total, 3000);
  assert.equal(cap.landed_total, 33000);
  assert.equal(cap.extra_costs.length, 1);
  assert.equal(cap.extra_costs[0].title, 'Дорога');

  const costA = getDepartmentStockWithCost(deptId, productA.id);
  const costB = getDepartmentStockWithCost(deptId, productB.id);
  assert.equal(costA.stock, 1);
  assert.equal(costB.stock, 2);
  assert.ok(Math.abs(costA.avgCost - 11000) < 1e-6);
  assert.ok(Math.abs(costB.avgCost - 11000) < 1e-6);

  const period = svc.createDocument({
    type: 'prihod',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [
      { product_id: productA.id, quantity: 2, price: 5000, amount: 10000, net_weight: 0.5 },
    ],
    extra_costs: [{ title: 'Дорога', amount: 3000, capitalize: false }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(period.total_amount, 10000);
  assert.equal(period.capitalized_extra_total, 0);
  const afterPeriod = getDepartmentStockWithCost(deptId, productA.id);
  assert.equal(afterPeriod.stock, 2);
  assert.ok(Math.abs(afterPeriod.avgCost - 10500) < 1e-6);

  svc.cancelDocument(cap.id, 'test-user');
  const afterCancelA = getDepartmentStockWithCost(deptId, productA.id);
  assert.equal(afterCancelA.stock, 1);
  assert.ok(Math.abs(afterCancelA.avgCost - 10000) < 1e-6);
});
