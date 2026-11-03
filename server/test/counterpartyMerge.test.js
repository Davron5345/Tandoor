import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

let testDir;
let db;
let svc;
let deps;
let deptId;
let mergeSvc;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-cp-merge-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_ENABLED = 'false';

  const dbMod = await import('../db.js');
  db = dbMod.default;
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  svc = await import('../services.js');
  deps = await import('../departments.js');
  mergeSvc = await import('../services/counterparties.js');
  await dbMod.initDb();
  initPermissions(db);
  seedDefaultUsers();
  deptId = deps.getDefaultDepartmentId('main');
});

after(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

test('mergeCounterpartyInto moves firms and rebinds documents/payments', () => {
  const murod = svc.createCounterparty({ name: 'Мурод merge', type: 'supplier' }, 'main');
  const cibos = svc.createCounterparty({ name: 'ООО CIBOS', type: 'supplier' }, 'main');
  const firm = mergeSvc.createCounterpartyFirm(cibos.id, {
    name: 'ООО CIBOS FOODSERVICE',
    inn: '308761740',
    bank_account: '20208000205424145001',
    is_default: true,
  }, 'main');

  const product = svc.createProduct({
    name: 'Товар merge',
    sku: `MERGE-${Date.now()}`,
    unit: 'шт',
    price: 100,
    branch_id: 'main',
    supplier_ids: [cibos.id],
  });
  const doc = svc.createDocument({
    type: 'prihod',
    date: '2026-10-01',
    counterparty_id: cibos.id,
    firm_id: firm.id,
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 1, price: 100 }],
  }, 'test-user', 'main');
  const pay = svc.createPayment({
    type: 'supplier_payment',
    amount: 100,
    date: '2026-10-02',
    counterparty_id: cibos.id,
    firm_id: firm.id,
  }, 'test-user', 'main');

  const result = mergeSvc.mergeCounterpartyInto(cibos.id, murod.id, 'main');
  assert.equal(result.target_id, murod.id);
  assert.equal(result.source_deleted, true);
  assert.ok(result.firms_moved >= 1);

  assert.equal(mergeSvc.getCounterparty(cibos.id, 'main'), null);
  const murodFirms = mergeSvc.getCounterpartyFirms(murod.id, 'main');
  assert.ok(murodFirms.some((f) => f.id === firm.id));

  const movedDoc = svc.getDocument(doc.id, 'main');
  assert.equal(movedDoc.counterparty_id, murod.id);

  const movedPay = db.queryOne('SELECT * FROM payments WHERE id = ?', [pay.id]);
  assert.equal(movedPay.counterparty_id, murod.id);
});

test('mergeCounterpartyInto collapses firms with same INN', () => {
  const murod = svc.createCounterparty({ name: 'Мурод collapse', type: 'supplier' }, 'main');
  const keep = mergeSvc.createCounterpartyFirm(murod.id, {
    name: 'Halol Food',
    inn: '301112223',
    bank_account: '20208000901111111111',
    is_default: true,
  }, 'main');

  const orphan = svc.createCounterparty({ name: 'Halol Meat', type: 'supplier' }, 'main');
  // обход проверки уникальности ИНН — как после частичного импорта/ручных данных
  const orphanFirmId = randomUUID();
  db.run(`
    INSERT INTO counterparty_firms
      (id, counterparty_id, branch_id, name, inn, bank_account, mfo, contract_id, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    orphanFirmId, orphan.id, 'main', 'Halol Meat LLC', '301112223',
    '20208000902222222222', null, null, 1,
  ]);

  const result = mergeSvc.mergeCounterpartyInto(orphan.id, murod.id, 'main');
  assert.equal(result.source_deleted, true);
  assert.ok(result.firms_collapsed >= 1);

  const firms = mergeSvc.getCounterpartyFirms(murod.id, 'main');
  const sameInn = firms.filter((f) => f.inn === '301112223');
  assert.equal(sameInn.length, 1);
  assert.equal(sameInn[0].id, keep.id);
  assert.equal(sameInn[0].bank_account, '20208000901111111111');

  const murodCp = mergeSvc.getCounterparty(murod.id, 'main');
  assert.match(String(murodCp.notes || ''), /20208000902222222222/);
  assert.equal(db.queryOne('SELECT id FROM counterparty_firms WHERE id = ?', [orphanFirmId]), null);
});

test('moveCounterpartyFirm relocates one firm and may delete empty source', () => {
  const target = svc.createCounterparty({ name: 'Цель move', type: 'supplier' }, 'main');
  const source = svc.createCounterparty({ name: 'Источник move', type: 'supplier' }, 'main');
  const firm = mergeSvc.createCounterpartyFirm(source.id, {
    name: 'Фирма Б',
    inn: '309998887',
    is_default: true,
  }, 'main');

  const moved = mergeSvc.moveCounterpartyFirm(source.id, firm.id, target.id, 'main');
  assert.equal(moved.target_id, target.id);
  assert.equal(moved.firm_id, firm.id);
  assert.equal(moved.source_deleted, true);
  assert.ok(mergeSvc.getCounterpartyFirms(target.id, 'main').some((f) => f.id === firm.id));
  assert.equal(mergeSvc.getCounterparty(source.id, 'main'), null);
});
