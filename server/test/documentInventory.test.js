import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-inventory-'));
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

test('inventory: surplus/shortage at avg_cost, P&L without cash, cancel restores stock', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const { getDepartmentStockWithCost } = await import('../inventoryCost.js');
  const { createBranch } = await import('../branches.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const productA = svc.createProduct({
    name: 'Инв A',
    sku: 'INV-A',
    unit: 'кг',
    price: 1000,
    branch_id: 'main',
  });
  const productB = svc.createProduct({
    name: 'Инв B',
    sku: 'INV-B',
    unit: 'кг',
    price: 2000,
    branch_id: 'main',
  });

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [
      { product_id: productA.id, quantity: 10, price: 1000 },
      { product_id: productB.id, quantity: 10, price: 2000 },
    ],
    status: 'confirmed',
  }, 'test-user', 'main');

  const snapshot = svc.getInventoryStockSnapshot(deptId, 'main');
  assert.equal(snapshot.length, 2);
  assert.ok(snapshot.every((row) => row.book_qty > 0));

  const inv = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [
      { product_id: productA.id, book_qty: 10, quantity: 12, unit_cost: 1000 },
      { product_id: productB.id, book_qty: 10, quantity: 7, unit_cost: 2000 },
    ],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(inv.type, 'inventory');
  assert.equal(inv.status, 'confirmed');
  assert.equal(inv.surplus_total, 2000);
  assert.equal(inv.shortage_total, 6000);
  assert.equal(inv.total_amount, 4000);

  const costA = getDepartmentStockWithCost(deptId, productA.id);
  const costB = getDepartmentStockWithCost(deptId, productB.id);
  assert.equal(costA.stock, 12);
  assert.equal(costB.stock, 7);
  assert.ok(Math.abs(costA.avgCost - 1000) < 1e-6);
  assert.ok(Math.abs(costB.avgCost - 2000) < 1e-6);

  const payments = db.queryAll('SELECT * FROM payments WHERE document_id = ?', [inv.id]);
  assert.equal(payments.length, 0);

  const pnl = svc.getPnLReport('main', '2026-08-01', '2026-08-31');
  const invExp = pnl.operating_expenses.items.find((i) => i.source === 'inventory');
  const invInc = pnl.other_income.items.find((i) => i.source === 'inventory');
  assert.ok(invExp);
  assert.equal(invExp.name, 'Инвентаризация');
  assert.equal(invExp.amount, 6000);
  assert.ok(invInc);
  assert.equal(invInc.amount, 2000);
  assert.equal(pnl.net_profit, -4000);

  const listed = svc.getDocuments({ branch_id: 'main' });
  assert.ok(!listed.some((d) => d.type === 'inventory'));
  const typed = svc.getDocuments({ branch_id: 'main', type: 'inventory' });
  assert.equal(typed.length, 1);
  assert.equal(typed[0].id, inv.id);

  svc.cancelDocument(inv.id, 'test-user');
  const afterCancelA = getDepartmentStockWithCost(deptId, productA.id);
  const afterCancelB = getDepartmentStockWithCost(deptId, productB.id);
  assert.equal(afterCancelA.stock, 10);
  assert.equal(afterCancelB.stock, 10);
  assert.ok(Math.abs(afterCancelA.avgCost - 1000) < 1e-6);
  assert.ok(Math.abs(afterCancelB.avgCost - 2000) < 1e-6);

  const pnlAfter = svc.getPnLReport('main', '2026-08-01', '2026-08-31');
  assert.ok(!pnlAfter.operating_expenses.items.some((i) => i.source === 'inventory'));
  assert.ok(!pnlAfter.other_income.items.some((i) => i.source === 'inventory'));
  assert.equal(pnlAfter.net_profit, 0);

  createBranch({ id: 'branch-inv', name: 'Филиал инв' });
  assert.equal(svc.getDocument(inv.id, 'branch-inv'), null);
  assert.throws(
    () => svc.createDocument({
      type: 'inventory',
      date: '2026-08-27',
      to_department_id: deptId,
      items: [{ product_id: productA.id, book_qty: 0, quantity: 1, unit_cost: 1000 }],
      status: 'draft',
    }, 'test-user', 'branch-inv'),
    /филиал/,
  );
});
