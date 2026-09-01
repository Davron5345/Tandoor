import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-stock-cost-'));
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

test('avg_cost is rounded to 4 decimals on receive', async () => {
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
    name: 'Округление avg',
    sku: 'AVG-ROUND-1',
    unit: 'кг',
    price: 1000,
    branch_id: 'main',
  });

  svc.createDocument({
    type: 'prihod',
    date: '2026-09-01',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 3, amount: 10 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  const { avgCost } = getDepartmentStockWithCost(deptId, product.id);
  assert.equal(avgCost, 3.3333);
});

test('cannot cancel prihod if a later prihod of the same product exists', async () => {
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
    name: 'Отмена позже',
    sku: 'CANCEL-LATER-1',
    unit: 'шт',
    price: 100,
    branch_id: 'main',
  });

  const first = svc.createDocument({
    type: 'prihod',
    date: '2026-06-19',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 5, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  svc.createDocument({
    type: 'prihod',
    date: '2026-06-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 2, price: 120 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.throws(() => svc.cancelDocument(first.id, 'test-user'), /более поздние/);
});

test('cannot unconfirm opening balance after a later prihod of the same stock', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const {
    createOpeningBalanceDocument,
    confirmOpeningBalanceDocument,
    cancelOpeningBalanceDocument,
  } = await import('../services/openingBalanceDocuments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const product = svc.createProduct({
    name: 'НС потом приход',
    sku: 'OB-CANCEL-1',
    unit: 'шт',
    price: 1000,
    branch_id: 'main',
  });

  const draft = createOpeningBalanceDocument({
    date: '2026-01-01',
    lines: [{
      line_type: 'stock',
      product_id: product.id,
      department_id: deptId,
      quantity: 10,
      unit_cost: 1000,
    }],
  }, 'test-user', 'main');
  confirmOpeningBalanceDocument(draft.id, 'test-user', 'main');

  svc.createDocument({
    type: 'prihod',
    date: '2026-06-19',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 1, price: 1100 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.throws(
    () => cancelOpeningBalanceDocument(draft.id, 'test-user', 'main'),
    /более поздние/,
  );
});

test('inventory surplus at avg 0 uses last prihod, else requires cost', async () => {
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
  const orphan = svc.createProduct({
    name: 'Излишек без цены',
    sku: 'INV-SUR-0',
    unit: 'кг',
    price: 9999,
    branch_id: 'main',
  });

  assert.throws(
    () => svc.createDocument({
      type: 'inventory',
      date: '2026-09-01',
      to_department_id: deptId,
      items: [{ product_id: orphan.id, book_qty: 0, quantity: 2, unit_cost: 0 }],
      status: 'confirmed',
    }, 'test-user', 'main'),
    /себестоимость излишка/,
  );

  const withHistory = svc.createProduct({
    name: 'Излишек после прихода',
    sku: 'INV-SUR-1',
    unit: 'кг',
    price: 9999,
    branch_id: 'main',
  });
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: withHistory.id, quantity: 4, price: 250 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  svc.createDocument({
    type: 'rashod',
    date: '2026-08-21',
    from_department_id: deptId,
    items: [{ product_id: withHistory.id, quantity: 4, price: 400 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(getDepartmentStockWithCost(deptId, withHistory.id).stock, 0);
  assert.equal(getDepartmentStockWithCost(deptId, withHistory.id).avgCost, 0);

  const snap = svc.getInventoryStockSnapshot(deptId, 'main', withHistory.id);
  assert.equal(snap[0].avg_cost, 0);
  assert.equal(snap[0].suggest_cost, 250);

  const inv = svc.createDocument({
    type: 'inventory',
    date: '2026-09-01',
    to_department_id: deptId,
    items: [{ product_id: withHistory.id, book_qty: 0, quantity: 2, unit_cost: 0 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  const after = getDepartmentStockWithCost(deptId, withHistory.id);
  assert.equal(after.stock, 2);
  assert.equal(after.avgCost, 250);
  assert.equal(inv.items[0].unit_cost, 250);

  const withManual = svc.createProduct({
    name: 'Излишек вручную',
    sku: 'INV-SUR-2',
    unit: 'кг',
    price: 9999,
    branch_id: 'main',
  });
  const manual = svc.createDocument({
    type: 'inventory',
    date: '2026-09-01',
    to_department_id: deptId,
    items: [{ product_id: withManual.id, book_qty: 0, quantity: 1, unit_cost: 80 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(getDepartmentStockWithCost(deptId, withManual.id).avgCost, 80);
  assert.equal(manual.items[0].unit_cost, 80);
});

test('product list price_trend compares last two prihods', async () => {
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
    name: 'Тренд цены',
    sku: 'TREND-1',
    unit: 'кг',
    price: 100,
    branch_id: 'main',
  });

  const once = svc.getProducts({ branch_id: 'main' });
  const before = (Array.isArray(once) ? once : once.items).find((p) => p.id === product.id);
  assert.ok(before);
  assert.equal(before.price_trend?.dir ?? null, null);

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-01',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 1, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-10',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 1, price: 140 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  const upList = svc.getProducts({ branch_id: 'main' });
  const up = (Array.isArray(upList) ? upList : upList.items).find((p) => p.id === product.id);
  assert.equal(up.price_trend.dir, 'up');
  assert.equal(up.price_trend.last, 140);
  assert.equal(up.price_trend.prev, 100);

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 1, price: 90 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  const downList = svc.getProducts({ branch_id: 'main' });
  const down = (Array.isArray(downList) ? downList : downList.items).find((p) => p.id === product.id);
  assert.equal(down.price_trend.dir, 'down');
  assert.equal(down.price_trend.last, 90);
  assert.equal(down.price_trend.prev, 140);
});

test('department stock qty is rounded to 3 decimals', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const { receiveDepartmentStock, getDepartmentStockWithCost } = await import('../inventoryCost.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const product = svc.createProduct({
    name: 'Округление остатка',
    sku: 'QTY-ROUND-1',
    unit: 'кг',
    price: 10,
    branch_id: 'main',
  });

  receiveDepartmentStock(deptId, product.id, 0.1, 10);
  receiveDepartmentStock(deptId, product.id, 0.2, 10);
  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 0.3);
});
