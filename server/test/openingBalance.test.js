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

test('opening balance affects debtor and creditor reports', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const { createCounterparty } = await import('../services/counterparties.js');
  const { getDebtorsReport, getCreditorsReport } = await import('../services/reports.js');
  const {
    saveBranchOpeningSettings,
    saveCounterpartyOpeningBalances,
    getBusinessBalanceSummary,
    getCurrentCashBalance,
  } = await import('../openingBalance.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const client = createCounterparty({ name: 'Клиент А', type: 'client' }, 'main');
  const supplier = createCounterparty({ name: 'Поставщик Б', type: 'supplier' }, 'main');

  saveCounterpartyOpeningBalances('main', [
    { id: client.id, opening_balance: 500000 },
    { id: supplier.id, opening_balance: 300000 },
  ]);

  saveBranchOpeningSettings('main', {
    as_of_date: '2026-01-01',
    cash_balance: 1000000,
    notes: 'test',
  });

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

  const cash = getCurrentCashBalance('main');
  assert.equal(cash.opening_cash, 1000000);
  assert.equal(cash.current, 1000000);

  const summary = getBusinessBalanceSummary('main');
  assert.equal(summary.debtors.total, 500000);
  assert.equal(summary.creditors.total, 300000);
  assert.equal(summary.cash.current, 1000000);
});
