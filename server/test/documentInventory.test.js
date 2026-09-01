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

test('inventory: confirm re-snapshots book so stock equals fact after later documents', async () => {
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
  const product = svc.createProduct({
    name: 'Инв live',
    sku: 'INV-LIVE-1',
    unit: 'кг',
    price: 500,
    branch_id: 'main',
  });
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 10, price: 500 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  const draft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [{ product_id: product.id, book_qty: 10, quantity: 8, unit_cost: 500 }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(draft.items[0].book_qty, 10);

  svc.createDocument({
    type: 'rashod',
    date: '2026-08-26',
    from_department_id: deptId,
    items: [{ product_id: product.id, quantity: 2, price: 800 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 8);

  const confirmed = svc.confirmDocument(draft.id, 'test-user');
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.items[0].book_qty, 8);
  assert.equal(confirmed.items[0].quantity, 8);
  assert.equal(confirmed.shortage_total, 0);
  assert.equal(confirmed.surplus_total, 0);
  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 8);
});

test('inventory: one draft per department; line snapshot includes zero stock', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId, createDepartment } = await import('../departments.js');
  const { getDepartmentStockWithCost } = await import('../inventoryCost.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const otherDept = createDepartment({ name: 'Инв другой отдел', branch_id: 'main' });
  const product = svc.createProduct({
    name: 'Инв draft lock',
    sku: 'INV-DRAFT-1',
    unit: 'кг',
    price: 100,
    branch_id: 'main',
  });

  const zeroSnap = svc.getInventoryStockSnapshot(deptId, 'main', product.id, null);
  assert.equal(zeroSnap.length, 1);
  assert.equal(zeroSnap[0].book_qty, 0);
  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 0);

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 4, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  const liveSnap = svc.getInventoryStockSnapshot(deptId, 'main', product.id);
  assert.equal(liveSnap[0].book_qty, 4);
  assert.equal(liveSnap[0].avg_cost, 100);

  const draft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [{ product_id: product.id, book_qty: 4, quantity: 4, unit_cost: 100 }],
    status: 'draft',
  }, 'test-user', 'main');

  assert.throws(
    () => svc.createDocument({
      type: 'inventory',
      date: '2026-08-27',
      to_department_id: deptId,
      items: [{ product_id: product.id, book_qty: 4, quantity: 3, unit_cost: 100 }],
      status: 'draft',
    }, 'test-user', 'main'),
    /черновик инвентаризации/,
  );

  const otherDraft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: otherDept.id,
    items: [{ product_id: product.id, book_qty: 0, quantity: 0, unit_cost: 100 }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(otherDraft.to_department_id, otherDept.id);

  assert.throws(
    () => svc.createDocument({
      type: 'inventory',
      date: '2026-08-27',
      to_department_id: deptId,
      items: [
        { product_id: product.id, book_qty: 4, quantity: 4, unit_cost: 100 },
        { product_id: product.id, book_qty: 4, quantity: 3, unit_cost: 100 },
      ],
      status: 'draft',
    }, 'test-user', 'main'),
    /уже есть в документе/,
  );

  svc.confirmDocument(draft.id, 'test-user');
  const nextDraft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-28',
    to_department_id: deptId,
    items: [{ product_id: product.id, book_qty: 4, quantity: 4, unit_cost: 100 }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(nextDraft.status, 'draft');
});

test('inventory snapshot for a variant uses the product unit', async () => {
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
    name: 'Инв вариант',
    sku: 'INV-VAR-1',
    unit: 'л',
    branch_id: 'main',
    has_variants: true,
    variants: [{ name: '0.5', price: 80 }],
  });
  const variantId = product.variants[0].id;

  const snap = svc.getInventoryStockSnapshot(deptId, 'main', product.id, variantId);
  assert.equal(snap.length, 1);
  assert.equal(snap[0].unit, 'л');
  assert.equal(snap[0].variant_id, variantId);
  assert.match(snap[0].name, /0\.5/);
});
