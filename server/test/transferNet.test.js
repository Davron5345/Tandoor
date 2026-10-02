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

test('cancel of net transfer checks and returns net × qty', async () => {
  const svc = await import('../services.js');
  const { createDepartment, getDefaultDepartmentId, getDepartmentStock } = await import('../departments.js');

  const fromDept = getDefaultDepartmentId('main');
  const toDept = createDepartment({ branch_id: 'main', name: 'Цех отмена' }).id;

  const half = svc.createProduct({ name: 'Отмена 0.5', sku: 'NET-TR-002', unit: 'кг', price: 1, branch_id: 'main' });
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-21',
    to_department_id: fromDept,
    items: [{ product_id: half.id, quantity: 10, price: 100, net_weight: 0.5 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  const t1 = svc.createDocument({
    type: 'peremeshchenie',
    date: '2026-08-21',
    from_branch_id: 'main',
    to_branch_id: 'main',
    from_department_id: fromDept,
    to_department_id: toDept,
    items: [{ product_id: half.id, quantity: 4, price: 0, net_weight: 0.5 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(getDepartmentStock(half.id, toDept), 2);
  svc.cancelDocument(t1.id, 'test-user');
  assert.equal(getDepartmentStock(half.id, fromDept), 5);
  assert.equal(getDepartmentStock(half.id, toDept), 0);

  const bag = svc.createProduct({ name: 'Мешок 5', sku: 'NET-TR-003', unit: 'кг', price: 1, branch_id: 'main' });
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-21',
    to_department_id: fromDept,
    items: [{ product_id: bag.id, quantity: 4, price: 100, net_weight: 5 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  const t2 = svc.createDocument({
    type: 'peremeshchenie',
    date: '2026-08-21',
    from_branch_id: 'main',
    to_branch_id: 'main',
    from_department_id: fromDept,
    to_department_id: toDept,
    items: [{ product_id: bag.id, quantity: 2, price: 0, net_weight: 5 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(getDepartmentStock(bag.id, toDept), 10);
  svc.zeroStockPosition('main', { department_id: toDept, product_id: bag.id, variant_id: null });
  assert.equal(getDepartmentStock(bag.id, toDept), 0);
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-21',
    to_department_id: toDept,
    items: [{ product_id: bag.id, quantity: 3, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(getDepartmentStock(bag.id, toDept), 3);
  assert.throws(() => svc.cancelDocument(t2.id, 'test-user'), /недостаточно «Мешок 5» в отделе-получателе/);
  assert.equal(getDepartmentStock(bag.id, fromDept), 10);
});

test('inter-branch transfer moves department stock between default departments', async () => {
  const svc = await import('../services.js');
  const { createDepartment, getDefaultDepartmentId, getDepartmentStock } = await import('../departments.js');
  const { createBranch, getBranchStock } = await import('../branches.js');

  const mainDept = getDefaultDepartmentId('main');
  const other = createBranch({ name: 'Филиал перемещения' });

  const product = svc.createProduct({ name: 'Межфилиал', sku: 'NET-TR-004', unit: 'шт', price: 1, branch_id: 'main' });
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-22',
    to_department_id: mainDept,
    items: [{ product_id: product.id, quantity: 10, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  const transferData = {
    type: 'peremeshchenie',
    date: '2026-08-22',
    from_branch_id: 'main',
    to_branch_id: other.id,
    items: [{ product_id: product.id, quantity: 4, price: 0 }],
    status: 'confirmed',
  };
  if (!getDefaultDepartmentId(other.id)) {
    assert.throws(() => svc.createDocument(transferData, 'test-user', 'main'), /нет активного отдела/);
    createDepartment({ branch_id: other.id, name: 'Склад филиала' });
  }
  const otherDept = getDefaultDepartmentId(other.id);

  const transfer = svc.createDocument(transferData, 'test-user', 'main');
  assert.equal(transfer.from_department_id, mainDept);
  assert.equal(transfer.to_department_id, otherDept);
  assert.equal(getDepartmentStock(product.id, mainDept), 6);
  assert.equal(getDepartmentStock(product.id, otherDept), 4);
  assert.equal(getBranchStock(product.id, 'main'), 6);
  assert.equal(getBranchStock(product.id, other.id), 4);

  const report = svc.getStockMovementReport(other.id, { date_from: '2026-08-01', date_to: '2026-08-31' });
  const row = report.rows.find((r) => r.product_id === product.id);
  assert.equal(row.movements.transfer_in, 4);
  assert.equal(row.closing, 4);

  svc.cancelDocument(transfer.id, 'test-user');
  assert.equal(getDepartmentStock(product.id, mainDept), 10);
  assert.equal(getDepartmentStock(product.id, otherDept), 0);
  assert.equal(getBranchStock(product.id, other.id), 0);
});
