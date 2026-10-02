import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;
let svc;
let deps;
let deptId;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-project-links-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';

  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  svc = await import('../services.js');
  deps = await import('../departments.js');
  await initDb();
  initPermissions(db);
  seedDefaultUsers();
  deptId = deps.getDefaultDepartmentId('main');
});

after(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

function product(sku, supplierId = null) {
  return svc.createProduct({
    name: `Товар ${sku}`,
    sku,
    unit: 'шт',
    price: 100,
    branch_id: 'main',
    ...(supplierId ? { supplier_ids: [supplierId] } : {}),
  });
}

test('editing a confirmed receipt is blocked when stock already moved later', () => {
  const supplier = svc.createCounterparty({ name: 'Поставщик правка', type: 'supplier' }, 'main');
  const p = product('LINK-EDIT', supplier.id);
  const prihod = svc.createDocument({
    type: 'prihod',
    date: '2026-09-01',
    to_department_id: deptId,
    counterparty_id: supplier.id,
    items: [{ product_id: p.id, quantity: 10, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  svc.createDocument({
    type: 'rashod',
    date: '2026-09-02',
    from_department_id: deptId,
    items: [{ product_id: p.id, quantity: 8, price: 150 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.throws(
    () => svc.updateDocument(prihod.id, {
      type: 'prihod',
      date: '2026-09-01',
      to_department_id: deptId,
      counterparty_id: supplier.id,
      items: [{ product_id: p.id, quantity: 10, price: 120 }],
      status: 'confirmed',
    }, 'test-user', 'main'),
    /Нельзя изменить проведённый документ/,
  );
  assert.equal(deps.getDepartmentStock(p.id, deptId), 2);
});

test('cancel is blocked by linked payments and confirmed returns', () => {
  const supplier = svc.createCounterparty({ name: 'Поставщик отмена', type: 'supplier' }, 'main');
  const p = product('LINK-CANCEL', supplier.id);
  const paid = svc.createDocument({
    type: 'prihod',
    date: '2026-09-03',
    to_department_id: deptId,
    counterparty_id: supplier.id,
    items: [{ product_id: p.id, quantity: 5, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  svc.createPayment({
    type: 'supplier_payment',
    amount: 500,
    date: '2026-09-03',
    counterparty_id: supplier.id,
    document_id: paid.id,
  }, 'test-user', 'main');
  assert.throws(() => svc.cancelDocument(paid.id, 'test-user'), /есть привязанные оплаты/);

  const withReturn = svc.createDocument({
    type: 'prihod',
    date: '2026-09-03',
    to_department_id: deptId,
    counterparty_id: supplier.id,
    items: [{ product_id: p.id, quantity: 5, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  svc.createDocument({
    type: 'return_supplier',
    date: '2026-09-03',
    from_department_id: deptId,
    counterparty_id: supplier.id,
    source_document_id: withReturn.id,
    items: [{ product_id: p.id, quantity: 2, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.throws(() => svc.cancelDocument(withReturn.id, 'test-user'), /проведён возврат поставщику/);
});

test('debtors and reconciliation act account for customer returns and period opening', () => {
  const client = svc.createCounterparty({ name: 'Клиент сверка', type: 'client' }, 'main');
  const p = product('LINK-RECON');
  svc.createDocument({
    type: 'prihod',
    date: '2026-07-01',
    to_department_id: deptId,
    items: [{ product_id: p.id, quantity: 20, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  const sale1 = svc.createDocument({
    type: 'rashod',
    date: '2026-07-05',
    from_department_id: deptId,
    counterparty_id: client.id,
    items: [{ product_id: p.id, quantity: 5, price: 200 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  svc.createDocument({
    type: 'rashod',
    date: '2026-08-05',
    from_department_id: deptId,
    counterparty_id: client.id,
    items: [{ product_id: p.id, quantity: 3, price: 200 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  svc.createDocument({
    type: 'return_customer',
    date: '2026-08-06',
    to_department_id: deptId,
    counterparty_id: client.id,
    source_document_id: sale1.id,
    items: [{ product_id: p.id, quantity: 1, price: 200 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  svc.createPayment({
    type: 'customer_income',
    amount: 300,
    date: '2026-08-07',
    document_id: sale1.id,
  }, 'test-user', 'main');

  const debtors = svc.getDebtorsReport('main', true);
  const row = debtors.rows.find((r) => r.id === client.id);
  assert.equal(row.returned, 200);
  assert.equal(row.balance, 1000 + 600 - 200 - 300);

  const act = svc.getReconciliationAct('main', {
    counterparty_id: client.id,
    date_from: '2026-08-01',
    date_to: '2026-08-31',
  });
  assert.equal(act.opening, 1000);
  assert.deepEqual(act.rows.map((r) => [r.operation, r.debit, r.credit]), [
    ['Расход клиенту', 600, 0],
    ['Возврат от клиента', 0, 200],
    ['Оплата от клиента', 0, 300],
  ]);
  const closing = act.opening + act.rows.reduce((s, r) => s + r.debit - r.credit, 0);
  assert.equal(closing, row.balance);
});

test('department with stock cannot be deleted', async () => {
  const { default: db } = await import('../db.js');
  const dept = deps.createDepartment({ branch_id: 'main', name: 'Удаляемый отдел' });
  const p = product('LINK-DEPT');
  db.run(
    'INSERT INTO product_department_stock (id, department_id, product_id, variant_id, stock, avg_cost) VALUES (?, ?, ?, NULL, 1, 100)',
    [`pds-${dept.id}`, dept.id, p.id],
  );
  assert.throws(() => deps.deleteDepartment(dept.id), /есть остатки/);

  const empty = deps.createDepartment({ branch_id: 'main', name: 'Пустой отдел' });
  deps.deleteDepartment(empty.id);
});

test('return to supplier takes the same stock per piece as the receipt (net weight)', () => {
  const supplier = svc.createCounterparty({ name: 'Поставщик нетто', type: 'supplier' }, 'main');
  const p = product('LINK-NET', supplier.id);
  const prihod = svc.createDocument({
    type: 'prihod',
    date: '2026-09-10',
    to_department_id: deptId,
    counterparty_id: supplier.id,
    items: [{ product_id: p.id, quantity: 10, price: 100, net_weight: 0.5 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(deps.getDepartmentStock(p.id, deptId), 5);

  const ret = svc.createDocument({
    type: 'return_supplier',
    date: '2026-09-11',
    from_department_id: deptId,
    counterparty_id: supplier.id,
    source_document_id: prihod.id,
    items: [{ product_id: p.id, quantity: 4, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(deps.getDepartmentStock(p.id, deptId), 3);
  assert.equal(ret.items[0].net_weight, 0.5);

  svc.cancelDocument(ret.id, 'test-user');
  assert.equal(deps.getDepartmentStock(p.id, deptId), 5);
});

test('opening balance adds stock instead of overwriting it', async () => {
  const ob = await import('../services/openingBalanceDocuments.js');
  const p = product('LINK-OB');
  svc.createDocument({
    type: 'prihod',
    date: '2026-09-01',
    to_department_id: deptId,
    items: [{ product_id: p.id, quantity: 2, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  const doc = ob.createOpeningBalanceDocument({
    date: '2026-09-02',
    lines: [{ line_type: 'stock', product_id: p.id, department_id: deptId, quantity: 3, unit_cost: 200 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(deps.getDepartmentStock(p.id, deptId), 5);
  ob.cancelOpeningBalanceDocument(doc.id, 'test-user', 'main');
  assert.equal(deps.getDepartmentStock(p.id, deptId), 2);
});

test('partial update keeps header and items that were not sent', () => {
  const supplier = svc.createCounterparty({ name: 'Поставщик частично', type: 'supplier' }, 'main');
  const p = product('LINK-PUT', supplier.id);
  const draft = svc.createDocument({
    type: 'prihod',
    date: '2026-09-12',
    to_department_id: deptId,
    counterparty_id: supplier.id,
    comment: 'старый',
    items: [{ product_id: p.id, quantity: 3, price: 100 }],
  }, 'test-user', 'main');
  const updated = svc.updateDocument(draft.id, { comment: 'новый' }, 'test-user', 'main');
  assert.equal(updated.comment, 'новый');
  assert.equal(updated.date, '2026-09-12');
  assert.equal(updated.counterparty_id, supplier.id);
  assert.equal(updated.items.length, 1);
  assert.equal(updated.items[0].quantity, 3);
});

test('money refunds move counterparty debt and stay out of P&L', () => {
  const supplier = svc.createCounterparty({ name: 'Поставщик возврат денег', type: 'supplier' }, 'main');
  const client = svc.createCounterparty({ name: 'Клиент займ', type: 'client' }, 'main');
  const p = product('LINK-REFUND', supplier.id);
  svc.createDocument({
    type: 'prihod',
    date: '2026-10-01',
    to_department_id: deptId,
    counterparty_id: supplier.id,
    items: [{ product_id: p.id, quantity: 10, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  svc.createPayment({ type: 'supplier_payment', amount: 1200, date: '2026-10-01', counterparty_id: supplier.id }, 'test-user', 'main');
  svc.createPayment({ type: 'other_income', amount: 200, date: '2026-10-02', counterparty_id: supplier.id }, 'test-user', 'main');
  svc.createPayment({ type: 'other_expense', amount: 500, date: '2026-10-02', counterparty_id: client.id }, 'test-user', 'main');

  const creditor = svc.getCreditorsReport('main', true).rows.find((r) => r.id === supplier.id);
  assert.equal(creditor.refunded, 200);
  assert.equal(creditor.balance, 0);
  const debtor = svc.getDebtorsReport('main', true).rows.find((r) => r.id === client.id);
  assert.equal(debtor.balance, 500);

  const act = svc.getReconciliationAct('main', { counterparty_id: supplier.id, date_from: '2026-10-01', date_to: '2026-10-31' });
  const refundRow = act.rows.find((r) => r.operation === 'Возврат денег от поставщика');
  assert.equal(refundRow.debit, 200);

  const pnl = svc.getPnLReport('main', '2026-10-01', '2026-10-31');
  assert.equal(pnl.other_income.total, 0);
  assert.equal(pnl.operating_expenses.total, 0);
});

test('branch without operations is deleted with its seeded data', async () => {
  const { default: db } = await import('../db.js');
  const branches = await import('../branches.js');
  const { seedBranchRoles, reloadRoles } = await import('../permissions.js');
  branches.createBranch({ id: 'del-b', name: 'Удаляемый филиал' });
  seedBranchRoles(db, 'del-b');
  branches.deleteBranch('del-b');
  reloadRoles(db);
  assert.equal(branches.getBranch('del-b'), null);
  assert.equal(db.queryOne("SELECT COUNT(*) as c FROM roles WHERE branch_id = 'del-b'").c, 0);
  assert.equal(db.queryOne("SELECT COUNT(*) as c FROM departments WHERE branch_id = 'del-b'").c, 0);
});

test('legacy inter-branch transfer repair moves department stock once', async () => {
  const { default: db } = await import('../db.js');
  const branches = await import('../branches.js');
  const { repairLegacyInterBranchTransfers } = await import('../services/transferRepair.js');
  branches.createBranch({ id: 'rep-b', name: 'Филиал ремонт' });
  deps.createDepartment({ branch_id: 'rep-b', name: 'Склад ремонт' });
  const p = product('LINK-REPAIR');
  svc.createDocument({
    type: 'prihod',
    date: '2026-09-01',
    to_department_id: deptId,
    items: [{ product_id: p.id, quantity: 10, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  db.run(`INSERT INTO documents (id, number, type, date, branch_id, from_branch_id, to_branch_id, total_amount, status)
          VALUES ('legacy-tr', 'L1', 'peremeshchenie', '2026-09-02', 'main', 'main', 'rep-b', 0, 'confirmed')`);
  db.run(`INSERT INTO document_items (id, document_id, product_id, quantity, price, amount, item_role)
          VALUES ('legacy-tr-1', 'legacy-tr', ?, 4, 0, 0, 'input')`, [p.id]);

  const dry = repairLegacyInterBranchTransfers();
  assert.equal(dry.fixed.length, 1, JSON.stringify(dry.skipped));
  assert.equal(deps.getDepartmentStock(p.id, deptId), 10);

  repairLegacyInterBranchTransfers({ apply: true });
  const toDept = deps.getDefaultDepartmentId('rep-b');
  assert.equal(deps.getDepartmentStock(p.id, deptId), 6);
  assert.equal(deps.getDepartmentStock(p.id, toDept), 4);
  assert.equal(repairLegacyInterBranchTransfers().fixed.length, 0);
});
