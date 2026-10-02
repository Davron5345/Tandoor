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
