import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'opening-balance-set-debt-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';
});

after(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('admin set-as-of-today writes delta and dated recon/report rows', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const { createCounterparty } = await import('../services/counterparties.js');
  const { getCreditorsReport, getCounterpartyDebtAsOf, getSupplierDebtMovementReport } = await import('../services/reports.js');
  const { getReconciliationAct } = await import('../services/reconciliation.js');
  const {
    createOpeningBalanceDocument,
    confirmOpeningBalanceDocument,
  } = await import('../services/openingBalanceDocuments.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const svc = await import('../services.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const supplier = createCounterparty({ name: 'Поставщик Сет', type: 'supplier' }, 'main');
  const deptId = getDefaultDepartmentId('main');
  const product = svc.createProduct({
    name: 'Товар сет',
    sku: 'OB-SET-1',
    unit: 'шт',
    price: 1000,
    branch_id: 'main',
    supplier_ids: [supplier.id],
  });

  const start = createOpeningBalanceDocument({
    date: '2026-01-01',
    lines: [{ line_type: 'creditor', counterparty_id: supplier.id, amount: 2_000_000 }],
  }, 'test-user', 'main');
  confirmOpeningBalanceDocument(start.id, 'test-user', 'main');

  const prihod = svc.createDocument({
    type: 'prihod',
    date: '2026-06-01',
    counterparty_id: supplier.id,
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 1, price: 500_000 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.ok(prihod.id);

  svc.createPayment({
    type: 'supplier_payment',
    date: '2026-06-10',
    counterparty_id: supplier.id,
    amount: 200_000,
  }, 'test-user', 'main');

  const before = getCounterpartyDebtAsOf('main', supplier.id, '2026-11-09');
  assert.equal(before.balance, 2_300_000);

  assert.throws(
    () => createOpeningBalanceDocument({
      date: '2026-11-09',
      lines: [{
        line_type: 'creditor',
        counterparty_id: supplier.id,
        amount: 1_500_000,
        balance_mode: 'set',
        target_amount: 1_500_000,
      }],
    }, 'test-user', 'main', { role: 'accountant' }),
    /только администратор/,
  );

  const draft = createOpeningBalanceDocument({
    date: '2026-11-09',
    lines: [{
      line_type: 'creditor',
      counterparty_id: supplier.id,
      amount: 1_500_000,
      balance_mode: 'set',
      target_amount: 1_500_000,
    }],
  }, 'test-user', 'main', { role: 'admin' });
  assert.equal(draft.lines[0].amount, 1_500_000);
  assert.equal(draft.lines[0].balance_mode, 'set');

  const confirmed = confirmOpeningBalanceDocument(draft.id, 'test-user', 'main');
  assert.equal(confirmed.lines[0].target_amount, 1_500_000);
  assert.equal(confirmed.lines[0].amount, -800_000);

  const creditors = getCreditorsReport('main', true, true);
  const row = creditors.rows.find((r) => r.id === supplier.id);
  assert.equal(row.balance, 1_500_000);

  assert.throws(
    () => {
      const again = createOpeningBalanceDocument({
        date: '2026-11-09',
        lines: [{
          line_type: 'creditor',
          counterparty_id: supplier.id,
          amount: 1_500_000,
          balance_mode: 'set',
          target_amount: 1_500_000,
        }],
      }, 'test-user', 'main', { role: 'admin' });
      confirmOpeningBalanceDocument(again.id, 'test-user', 'main');
    },
    /уже равен/,
  );

  const actNov = getReconciliationAct('main', {
    counterparty_id: supplier.id,
    date_from: '2026-11-01',
    date_to: '2026-11-30',
  });
  assert.equal(actNov.opening, 2_300_000);
  const setRow = actNov.rows.find((r) => r.operation === 'Корректировка долга');
  assert.ok(setRow);
  assert.equal(setRow.docType, 'opening_balance');
  assert.equal(setRow.credit, 800_000);
  assert.equal(setRow.debit, 0);
  const closing = actNov.opening + actNov.rows.reduce((s, r) => s + r.debit - r.credit, 0);
  assert.equal(closing, 1_500_000);

  const july = getSupplierDebtMovementReport('main', '2026-06-01', '2026-06-30');
  const julyRow = july.rows.find((r) => r.id === supplier.id);
  assert.equal(julyRow.opening_debt, 2_000_000);
  assert.equal(julyRow.prihod, 500_000);
  assert.equal(julyRow.payment, 200_000);
  assert.equal(julyRow.saldo_adjust, 0);
  assert.equal(julyRow.closing_debt, 2_300_000);

  const nov = getSupplierDebtMovementReport('main', '2026-11-01', '2026-11-30');
  const novRow = nov.rows.find((r) => r.id === supplier.id);
  assert.equal(novRow.opening_debt, 2_300_000);
  assert.equal(novRow.saldo_adjust, -800_000);
  assert.equal(novRow.closing_debt, 1_500_000);
});

test('empty amount for selected supplier is zero debt', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const { createCounterparty } = await import('../services/counterparties.js');
  const { getCreditorsReport, getCounterpartyDebtAsOf } = await import('../services/reports.js');
  const {
    createOpeningBalanceDocument,
    confirmOpeningBalanceDocument,
  } = await import('../services/openingBalanceDocuments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const none = createCounterparty({ name: 'Без долга', type: 'supplier' }, 'main');
  const owed = createCounterparty({ name: 'Был долг', type: 'supplier' }, 'main');

  const zeroDraft = createOpeningBalanceDocument({
    date: '2026-01-01',
    lines: [{ line_type: 'creditor', counterparty_id: none.id }],
  }, 'test-user', 'main');
  assert.equal(zeroDraft.lines[0].amount, 0);
  confirmOpeningBalanceDocument(zeroDraft.id, 'test-user', 'main');
  const noneRow = getCreditorsReport('main', true, true).rows.find((r) => r.id === none.id);
  assert.equal(noneRow?.balance || 0, 0);

  const start = createOpeningBalanceDocument({
    date: '2026-01-01',
    lines: [{ line_type: 'creditor', counterparty_id: owed.id, amount: 900_000 }],
  }, 'test-user', 'main');
  confirmOpeningBalanceDocument(start.id, 'test-user', 'main');
  assert.equal(getCounterpartyDebtAsOf('main', owed.id, '2026-11-09').balance, 900_000);

  const zeroSet = createOpeningBalanceDocument({
    date: '2026-11-09',
    lines: [{
      line_type: 'creditor',
      counterparty_id: owed.id,
      balance_mode: 'set',
    }],
  }, 'test-user', 'main', { role: 'admin' });
  assert.equal(zeroSet.lines[0].amount, 0);
  assert.equal(zeroSet.lines[0].target_amount, 0);
  const confirmed = confirmOpeningBalanceDocument(zeroSet.id, 'test-user', 'main');
  assert.equal(confirmed.lines[0].amount, -900_000);
  assert.equal(getCounterpartyDebtAsOf('main', owed.id, '2026-11-09').balance, 0);
});
