import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'supplier-debt-report-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';
});

after(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('supplier debt movement report calculates opening, period and closing balances', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const { createCounterparty } = await import('../services/counterparties.js');
  const { getSupplierDebtMovementReport } = await import('../services/reports.js');
  const { createOpeningBalanceDocument, confirmOpeningBalanceDocument } = await import('../services/openingBalanceDocuments.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const svc = await import('../services.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const supplier = createCounterparty({ name: 'Поставщик X', type: 'supplier' }, 'main');
  const deptId = getDefaultDepartmentId('main');
  const product = svc.createProduct({
    name: 'Товар отчёт',
    sku: 'SDR-1',
    unit: 'шт',
    price: 1000,
    branch_id: 'main',
    supplier_ids: [supplier.id],
  });

  const draft = createOpeningBalanceDocument({
    date: '2026-01-01',
    lines: [{ line_type: 'creditor', counterparty_id: supplier.id, amount: 1_000_000 }],
  }, 'test-user', 'main');
  confirmOpeningBalanceDocument(draft.id, 'test-user', 'main');

  const prihod = svc.createDocument({
    type: 'prihod',
    date: '2026-07-05',
    counterparty_id: supplier.id,
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 500, price: 1000 }],
    status: 'draft',
  }, 'test-user', 'main');
  svc.confirmDocument(prihod.id, 'test-user', 'main');

  svc.createPayment({
    type: 'supplier_payment',
    date: '2026-07-05',
    counterparty_id: supplier.id,
    amount: 200_000,
    article_id: null,
    comment: 'Оплата',
  }, 'test-user', 'main');

  const report = getSupplierDebtMovementReport('main', '2026-07-05', '2026-07-05');
  const row = report.rows.find((r) => r.id === supplier.id);
  assert.ok(row);
  assert.equal(row.opening_debt, 1_000_000);
  assert.equal(row.prihod, 500_000);
  assert.equal(row.payment, 200_000);
  assert.equal(row.closing_debt, 1_300_000);
  assert.equal(report.totals.closing_debt, 1_300_000);
});
