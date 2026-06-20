import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'dish-sale-test-'));
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

test('dish_sale writes revenue to P&L and consumes ingredients', async () => {
  const { initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const db = (await import('../db.js')).default;
  const { getDefaultDepartmentId } = await import('../departments.js');
  const { createCalculation, CALC_KIND_RECIPE } = await import('../calculations.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const potato = svc.createProduct({
    name: 'Картофель',
    sku: 'POT-001',
    unit: 'кг',
    price: 0,
    branch_id: 'main',
  });
  const dish = svc.createProduct({
    name: 'Пюре',
    sku: 'DISH-001',
    unit: 'порц',
    price: 5000,
    branch_id: 'main',
  });

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-01',
    to_department_id: deptId,
    items: [{ product_id: potato.id, quantity: 20, price: 1000 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  createCalculation({
    name: 'Рецепт пюре',
    kind: CALC_KIND_RECIPE,
    active: true,
    sources: [{ product_id: potato.id, quantity: 0.2 }],
    items: [{ product_id: dish.id, quantity: 1, price: 0, is_waste: false }],
  }, 'main');

  const sale = svc.createDocument({
    type: 'dish_sale',
    date: '2026-08-10',
    from_department_id: deptId,
    items: [{ product_id: dish.id, quantity: 2, price: 5000 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(sale.total_amount, 10000);

  const stock = db.queryOne(
    'SELECT stock FROM product_department_stock WHERE department_id = ? AND product_id = ?',
    [deptId, potato.id],
  );
  assert.equal(stock.stock, 19.6);

  const consumption = db.queryAll(
    'SELECT * FROM document_items WHERE document_id = ? AND item_role = ?',
    [sale.id, 'consumption'],
  );
  assert.equal(consumption.length, 1);
  assert.equal(consumption[0].quantity, 0.4);

  const saleLine = db.queryOne(
    'SELECT * FROM document_items WHERE document_id = ? AND item_role = ?',
    [sale.id, 'sale'],
  );
  assert.equal(saleLine.cost_amount, 400);

  const pnl = svc.getPnLReport('main', '2026-08-01', '2026-08-31');
  assert.equal(pnl.revenue.dishes, 10000);
  assert.equal(pnl.revenue.total, 10000);
  assert.equal(pnl.cogs.total, 400);
  assert.equal(pnl.gross_profit, 9600);
});
