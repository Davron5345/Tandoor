import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'opening-balance-test-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';
});

after(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('opening balance document affects reports and money balances', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const { createCounterparty } = await import('../services/counterparties.js');
  const { getDebtorsReport, getCreditorsReport } = await import('../services/reports.js');
  const { getBusinessBalanceSummary, getMoneyBalances } = await import('../openingBalance.js');
  const { createOpeningBalanceDocument, confirmOpeningBalanceDocument } = await import('../services/openingBalanceDocuments.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const svc = await import('../services.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const client = createCounterparty({ name: 'Клиент А', type: 'client' }, 'main');
  const supplier = createCounterparty({ name: 'Поставщик Б', type: 'supplier' }, 'main');
  const deptId = getDefaultDepartmentId('main');
  const product = svc.createProduct({
    name: 'Товар нач. сальdo',
    sku: 'OB-1',
    unit: 'шт',
    price: 1000,
    branch_id: 'main',
  });

  const draft = createOpeningBalanceDocument({
    date: '2026-01-01',
    comment: 'Старт учёта',
    lines: [
      { line_type: 'cash', amount: 1000000 },
      { line_type: 'bank', amount: 500000 },
      { line_type: 'debtor', counterparty_id: client.id, amount: 500000 },
      { line_type: 'creditor', counterparty_id: supplier.id, amount: 300000 },
      {
        line_type: 'stock',
        product_id: product.id,
        department_id: deptId,
        quantity: 10,
        unit_cost: 1000,
      },
    ],
  }, 'test-user', 'main');

  confirmOpeningBalanceDocument(draft.id, 'test-user', 'main');

  const debtors = getDebtorsReport('main', true, true);
  const clientRow = debtors.rows.find((r) => r.id === client.id);
  assert.ok(clientRow);
  assert.equal(clientRow.opening_balance, 500000);
  assert.equal(clientRow.balance, 500000);

  const creditors = getCreditorsReport('main', true, true);
  const supplierRow = creditors.rows.find((r) => r.id === supplier.id);
  assert.ok(supplierRow);
  assert.equal(supplierRow.opening_balance, 300000);
  assert.equal(supplierRow.balance, 300000);

  const money = getMoneyBalances('main');
  assert.equal(money.opening_cash, 1000000);
  assert.equal(money.opening_bank, 500000);
  assert.equal(money.current_cash, 1000000);
  assert.equal(money.current_bank, 500000);
  assert.equal(money.start_date, '2026-01-01');

  const summary = getBusinessBalanceSummary('main');
  assert.equal(summary.debtors.total, 500000);
  assert.equal(summary.creditors.total, 300000);
  assert.equal(summary.money.current_total, 1500000);
  assert.ok(summary.stock.value >= 10000);
});
