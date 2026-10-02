import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-stock-movement-'));
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

test('stock movement report: opening, movements by kind and closing per department', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { createDepartment, getDefaultDepartmentId, getDepartmentStock } = await import('../departments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptA = getDefaultDepartmentId('main');
  const deptB = createDepartment({ branch_id: 'main', name: 'Кухня движение' }).id;

  const product = svc.createProduct({
    name: 'Масло движение',
    sku: 'MOVE-001',
    unit: 'кг',
    price: 10000,
    net_weight: 0.5,
    branch_id: 'main',
  });

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-01',
    to_department_id: deptA,
    items: [{ product_id: product.id, quantity: 10, price: 10000, net_weight: 0.5 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  svc.createDocument({
    type: 'peremeshchenie',
    date: '2026-08-10',
    from_branch_id: 'main',
    to_branch_id: 'main',
    from_department_id: deptA,
    to_department_id: deptB,
    items: [{ product_id: product.id, quantity: 4, price: 0, net_weight: 0.5 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  svc.createDocument({
    type: 'rashod',
    date: '2026-08-15',
    from_department_id: deptB,
    items: [{ product_id: product.id, quantity: 1, price: 15000 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  svc.createDocument({
    type: 'inventory',
    date: '2026-08-20',
    to_department_id: deptA,
    items: [{ product_id: product.id, book_qty: 3, quantity: 2, unit_cost: 20000 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  svc.createDocument({
    type: 'rashod',
    date: '2026-08-25',
    from_department_id: deptB,
    items: [{ product_id: product.id, quantity: 0.5, price: 15000 }],
    status: 'draft',
  }, 'test-user', 'main');

  const report = svc.getStockMovementReport('main', { date_from: '2026-08-05', date_to: '2026-08-31' });
  const rowA = report.rows.find((r) => r.product_id === product.id && r.department_id === deptA);
  const rowB = report.rows.find((r) => r.product_id === product.id && r.department_id === deptB);

  assert.equal(rowA.opening, 5);
  assert.equal(rowA.movements.prihod, 0);
  assert.equal(rowA.movements.transfer_out, 2);
  assert.equal(rowA.movements.inventory_minus, 1);
  assert.equal(rowA.closing, 2);
  assert.equal(rowA.closing, getDepartmentStock(product.id, deptA));

  assert.equal(rowB.opening, 0);
  assert.equal(rowB.movements.transfer_in, 2);
  assert.equal(rowB.movements.rashod, 1);
  assert.equal(rowB.in_total, 2);
  assert.equal(rowB.out_total, 1);
  assert.equal(rowB.closing, 1);
  assert.equal(rowB.closing, getDepartmentStock(product.id, deptB));

  const onlyB = svc.getStockMovementReport('main', {
    date_from: '2026-08-05',
    date_to: '2026-08-31',
    department_id: deptB,
  });
  assert.ok(onlyB.rows.every((r) => r.department_id === deptB));

  const beforePeriod = svc.getStockMovementReport('main', { date_from: '2026-08-01', date_to: '2026-08-05' });
  const rowAEarly = beforePeriod.rows.find((r) => r.product_id === product.id && r.department_id === deptA);
  assert.equal(rowAEarly.opening, 0);
  assert.equal(rowAEarly.movements.prihod, 5);
  assert.ok(!beforePeriod.rows.some((r) => r.department_id === deptB && r.product_id === product.id));

  const details = svc.getStockMovementDetails('main', {
    product_id: product.id,
    variant_id: '',
    department_id: deptA,
    date_from: '2026-08-05',
    date_to: '2026-08-31',
  });
  assert.equal(details.opening, 5);
  assert.deepEqual(details.lines.map((l) => [l.kind, l.in_qty, l.out_qty, l.balance]), [
    ['transfer_out', 0, 2, 3],
    ['inventory_minus', 0, 1, 2],
  ]);
  assert.equal(details.closing, 2);

  assert.throws(
    () => svc.getStockMovementReport('main', { department_id: 'missing-dept' }),
    /Отдел не найден/,
  );
});
