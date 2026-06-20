import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cashArticleId } from '../cashArticleDefaults.js';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'pnl-test-'));
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

test('rashod confirm saves cost_amount on document items', async () => {
  const { initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const db = (await import('../db.js')).default;
  const { getDefaultDepartmentId } = await import('../departments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const product = svc.createProduct({
    name: 'P&L товар',
    sku: 'PNL-001',
    unit: 'шт',
    price: 1500,
    branch_id: 'main',
  });

  const prihod = svc.createDocument({
    type: 'prihod',
    date: '2026-06-01',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 10, price: 1000 }],
    status: 'draft',
  }, 'test-user', 'main');
  svc.confirmDocument(prihod.id, 'test-user');

  const rashod = svc.createDocument({
    type: 'rashod',
    date: '2026-06-15',
    from_department_id: deptId,
    items: [{ product_id: product.id, quantity: 4, price: 1500 }],
    status: 'draft',
  }, 'test-user', 'main');
  svc.confirmDocument(rashod.id, 'test-user');

  const item = db.queryOne('SELECT * FROM document_items WHERE document_id = ?', [rashod.id]);
  assert.equal(item.amount, 6000);
  assert.equal(item.unit_cost, 1000);
  assert.equal(item.cost_amount, 4000);

  const pnl = svc.getPnLReport('main', '2026-06-01', '2026-06-30');
  assert.equal(pnl.revenue.total, 6000);
  assert.equal(pnl.cogs.total, 4000);
  assert.equal(pnl.gross_profit, 2000);
  assert.equal(pnl.gross_margin_pct, 33.33);
});

test('P&L excludes purchase cash article from operating expenses', async () => {
  const { initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');

  await initDb();
  initPermissions((await import('../db.js')).default);
  seedDefaultUsers();

  const supplier = svc.createCounterparty({
    name: 'Поставщик P&L',
    type: 'supplier',
  }, 'main');

  svc.createPayment({
    type: 'other_expense',
    amount: 500000,
    date: '2026-06-10',
    article_id: cashArticleId('main', 'exp_salary'),
    comment: 'Зарплата',
  }, 'test-user', 'main');

  svc.createPayment({
    type: 'supplier_payment',
    amount: 1000000,
    date: '2026-06-11',
    counterparty_id: supplier.id,
    article_id: null,
    comment: 'Оплата поставщику',
  }, 'test-user', 'main');

  svc.createPayment({
    type: 'other_income',
    amount: 50000,
    date: '2026-06-12',
    article_id: cashArticleId('main', 'inc_other'),
    comment: 'Прочий доход',
  }, 'test-user', 'main');

  const pnl = svc.getPnLReport('main', '2026-06-01', '2026-06-30');
  assert.equal(pnl.operating_expenses.total, 500000);
  assert.equal(pnl.other_income.total, 50000);
  assert.ok(pnl.operating_expenses.items.some((i) => i.name === 'Зарплата'));
  assert.ok(!pnl.operating_expenses.items.some((i) => i.name === 'Закуп'));
});
