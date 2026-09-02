import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-inventory-'));
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

test('inventory: surplus/shortage at avg_cost, P&L without cash, cancel restores stock', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const { getDepartmentStockWithCost } = await import('../inventoryCost.js');
  const { createBranch } = await import('../branches.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const productA = svc.createProduct({
    name: 'Инв A',
    sku: 'INV-A',
    unit: 'кг',
    price: 1000,
    branch_id: 'main',
  });
  const productB = svc.createProduct({
    name: 'Инв B',
    sku: 'INV-B',
    unit: 'кг',
    price: 2000,
    branch_id: 'main',
  });

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [
      { product_id: productA.id, quantity: 10, price: 1000 },
      { product_id: productB.id, quantity: 10, price: 2000 },
    ],
    status: 'confirmed',
  }, 'test-user', 'main');

  const snapshot = svc.getInventoryStockSnapshot(deptId, 'main');
  assert.equal(snapshot.length, 2);
  assert.ok(snapshot.every((row) => row.book_qty > 0));

  const inv = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [
      { product_id: productA.id, book_qty: 10, quantity: 12, unit_cost: 1000 },
      { product_id: productB.id, book_qty: 10, quantity: 7, unit_cost: 2000 },
    ],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(inv.type, 'inventory');
  assert.equal(inv.status, 'confirmed');
  assert.equal(inv.surplus_total, 2000);
  assert.equal(inv.shortage_total, 6000);
  assert.equal(inv.total_amount, 4000);

  const costA = getDepartmentStockWithCost(deptId, productA.id);
  const costB = getDepartmentStockWithCost(deptId, productB.id);
  assert.equal(costA.stock, 12);
  assert.equal(costB.stock, 7);
  assert.ok(Math.abs(costA.avgCost - 1000) < 1e-6);
  assert.ok(Math.abs(costB.avgCost - 2000) < 1e-6);

  const payments = db.queryAll('SELECT * FROM payments WHERE document_id = ?', [inv.id]);
  assert.equal(payments.length, 0);

  const pnl = svc.getPnLReport('main', '2026-08-01', '2026-08-31');
  const invExp = pnl.operating_expenses.items.find((i) => i.source === 'inventory');
  const invInc = pnl.other_income.items.find((i) => i.source === 'inventory');
  assert.ok(invExp);
  assert.equal(invExp.name, 'Инвентаризация');
  assert.equal(invExp.amount, 6000);
  assert.ok(invInc);
  assert.equal(invInc.amount, 2000);
  assert.equal(pnl.net_profit, -4000);

  const listed = svc.getDocuments({ branch_id: 'main' });
  assert.ok(!listed.some((d) => d.type === 'inventory'));
  const typed = svc.getDocuments({ branch_id: 'main', type: 'inventory' });
  assert.equal(typed.length, 1);
  assert.equal(typed[0].id, inv.id);
  assert.equal(typed[0].counted_amount, 26000);
  assert.equal(typed[0].stock_amount, 26000);

  svc.cancelDocument(inv.id, 'test-user');
  assert.equal(svc.getDocument(inv.id, 'main').status, 'draft');
  const afterCancelA = getDepartmentStockWithCost(deptId, productA.id);
  const afterCancelB = getDepartmentStockWithCost(deptId, productB.id);
  assert.equal(afterCancelA.stock, 10);
  assert.equal(afterCancelB.stock, 10);
  assert.ok(Math.abs(afterCancelA.avgCost - 1000) < 1e-6);
  assert.ok(Math.abs(afterCancelB.avgCost - 2000) < 1e-6);

  const pnlAfter = svc.getPnLReport('main', '2026-08-01', '2026-08-31');
  assert.ok(!pnlAfter.operating_expenses.items.some((i) => i.source === 'inventory'));
  assert.ok(!pnlAfter.other_income.items.some((i) => i.source === 'inventory'));
  assert.equal(pnlAfter.net_profit, 0);

  createBranch({ id: 'branch-inv', name: 'Филиал инв' });
  assert.equal(svc.getDocument(inv.id, 'branch-inv'), null);
  assert.throws(
    () => svc.createDocument({
      type: 'inventory',
      date: '2026-08-27',
      to_department_id: deptId,
      items: [{ product_id: productA.id, book_qty: 0, quantity: 1, unit_cost: 1000 }],
      status: 'draft',
    }, 'test-user', 'branch-inv'),
    /филиал/,
  );
  svc.deleteDocument(inv.id);
});

test('inventory: confirm re-snapshots book so stock equals fact after later documents', async () => {
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
    name: 'Инв live',
    sku: 'INV-LIVE-1',
    unit: 'кг',
    price: 500,
    branch_id: 'main',
  });
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 10, price: 500 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  const draft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [{ product_id: product.id, book_qty: 10, quantity: 8, unit_cost: 500 }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(draft.items[0].book_qty, 10);

  svc.createDocument({
    type: 'rashod',
    date: '2026-08-26',
    from_department_id: deptId,
    items: [{ product_id: product.id, quantity: 2, price: 800 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 8);

  const confirmed = svc.confirmDocument(draft.id, 'test-user');
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.items[0].book_qty, 8);
  assert.equal(confirmed.items[0].quantity, 8);
  assert.equal(confirmed.shortage_total, 0);
  assert.equal(confirmed.surplus_total, 0);
  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 8);
});

test('inventory: one draft per department; line snapshot includes zero stock', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId, createDepartment } = await import('../departments.js');
  const { getDepartmentStockWithCost } = await import('../inventoryCost.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const otherDept = createDepartment({ name: 'Инв другой отдел', branch_id: 'main' });
  const product = svc.createProduct({
    name: 'Инв draft lock',
    sku: 'INV-DRAFT-1',
    unit: 'кг',
    price: 100,
    branch_id: 'main',
  });

  const zeroSnap = svc.getInventoryStockSnapshot(deptId, 'main', product.id, null);
  assert.equal(zeroSnap.length, 1);
  assert.equal(zeroSnap[0].book_qty, 0);
  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 0);

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 4, price: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  const liveSnap = svc.getInventoryStockSnapshot(deptId, 'main', product.id);
  assert.equal(liveSnap[0].book_qty, 4);
  assert.equal(liveSnap[0].avg_cost, 100);

  const draft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [{ product_id: product.id, book_qty: 4, quantity: 4, unit_cost: 0 }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(draft.items[0].unit_cost, 100);
  assert.equal(draft.counted_amount, 400);
  assert.equal(draft.stock_amount, 400);

  const reused = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [{ product_id: product.id, book_qty: 4, quantity: 3, unit_cost: 100 }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(reused.id, draft.id);
  assert.equal(reused.items[0].quantity, 3);
  assert.equal(
    svc.getDocuments({ branch_id: 'main', type: 'inventory', status: 'draft' })
      .filter((d) => d.to_department_id === deptId).length,
    1,
  );

  const extraProduct = svc.createProduct({
    name: 'Инв доп',
    sku: 'INV-KEEP-2',
    unit: 'кг',
    price: 50,
    net_weight: 1,
    branch_id: 'main',
  });
  const merged = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [{
      product_id: extraProduct.id,
      book_qty: 0,
      quantity: 2,
      net_weight: 0.5,
      unit_cost: 50,
    }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(merged.id, draft.id);
  const mergedA = merged.items.find((item) => item.product_id === product.id);
  const mergedB = merged.items.find((item) => item.product_id === extraProduct.id);
  assert.equal(mergedA.quantity, 3);
  assert.equal(mergedB.quantity, 2);
  assert.equal(Number(mergedB.net_weight), 0.5);
  const reloaded = svc.getDocument(draft.id, 'main');
  assert.equal(Number(reloaded.items.find((item) => item.product_id === extraProduct.id).net_weight), 0.5);

  const otherDraft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: otherDept.id,
    items: [{ product_id: product.id, book_qty: 0, quantity: 0, unit_cost: 100 }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(otherDraft.to_department_id, otherDept.id);

  assert.throws(
    () => svc.createDocument({
      type: 'inventory',
      date: '2026-08-27',
      to_department_id: deptId,
      items: [
        { product_id: product.id, book_qty: 4, quantity: 4, unit_cost: 100 },
        { product_id: product.id, book_qty: 4, quantity: 3, unit_cost: 100 },
      ],
      status: 'draft',
    }, 'test-user', 'main'),
    /уже есть в документе/,
  );

  svc.updateDocument(draft.id, {
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [{ product_id: product.id, book_qty: 4, quantity: 4, unit_cost: 100 }],
    status: 'draft',
  }, 'test-user', 'main');
  svc.confirmDocument(draft.id, 'test-user');
  const nextDraft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-28',
    to_department_id: deptId,
    items: [{ product_id: product.id, book_qty: 4, quantity: 4, unit_cost: 100 }],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(nextDraft.status, 'draft');
});

test('inventory snapshot for a variant uses the product unit', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId, createDepartment } = await import('../departments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = createDepartment({ name: 'Отдел варианты инв', branch_id: 'main' }).id;
  const product = svc.createProduct({
    name: 'Инв вариант',
    sku: 'INV-VAR-1',
    unit: 'л',
    branch_id: 'main',
    has_variants: true,
    variants: [{ name: '0.5', price: 80 }, { name: '1.0', price: 90 }],
  });
  const v05 = product.variants.find((v) => v.name === '0.5');
  const v10 = product.variants.find((v) => v.name === '1.0');
  assert.ok(v05 && v10);

  const snap = svc.getInventoryStockSnapshot(deptId, 'main', product.id, v05.id);
  assert.equal(snap.length, 1);
  assert.equal(snap[0].unit, 'л');
  assert.equal(snap[0].variant_id, v05.id);
  assert.match(snap[0].name, /0\.5/);
  assert.equal(snap[0].variant_name, '0.5');

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [
      { product_id: product.id, variant_id: v05.id, quantity: 1, price: 80 },
      { product_id: product.id, variant_id: v10.id, quantity: 1, price: 90 },
    ],
    status: 'confirmed',
  }, 'test-user', 'main');

  const draft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [
      { product_id: product.id, variant_id: v05.id, book_qty: 1, quantity: 1.9, unit_cost: 80 },
      { product_id: product.id, variant_id: v10.id, book_qty: 1, quantity: 1.4, unit_cost: 90 },
    ],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(draft.items.length, 2);
  assert.equal(draft.items[0].variant_id, v05.id);
  assert.equal(draft.items[0].variant_name, '0.5');
  assert.equal(draft.items[0].product_name, 'Инв вариант');
  assert.equal(draft.items[0].quantity, 1.9);
  assert.equal(draft.items[1].variant_name, '1.0');
  assert.equal(draft.items[1].quantity, 1.4);

  const saved = svc.updateDocument(draft.id, {
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    items: [
      { product_id: product.id, variant_id: v05.id, book_qty: 1, quantity: 1.9, unit_cost: 80 },
      { product_id: product.id, variant_id: v10.id, book_qty: 1, quantity: 1.4, unit_cost: 90 },
    ],
    status: 'draft',
  }, 'test-user', 'main');
  assert.equal(saved.items[0].quantity, 1.9);
  assert.equal(saved.items[0].book_qty, 1);
  assert.equal(saved.items[0].variant_id, v05.id);
  assert.equal(saved.items[1].quantity, 1.4);
  assert.equal(saved.items[1].variant_name, '1.0');
});

test('inventory: partial leaves unlisted stock; full writes off leftovers with article', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId, createDepartment } = await import('../departments.js');
  const { getDepartmentStockWithCost } = await import('../inventoryCost.js');
  const { cashArticleId, SHORTAGE_ARTICLE_CODE, DEBT_RETURN_ARTICLE_CODE } = await import('../cashArticleDefaults.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = createDepartment({ name: 'Отдел покрытие', branch_id: 'main' }).id;
  const counted = svc.createProduct({
    name: 'Инв counted',
    sku: 'INV-COV-A',
    unit: 'кг',
    price: 100,
    branch_id: 'main',
  });
  const leftover = svc.createProduct({
    name: 'Инв leftover',
    sku: 'INV-COV-B',
    unit: 'кг',
    price: 200,
    branch_id: 'main',
  });
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [
      { product_id: counted.id, quantity: 10, price: 100 },
      { product_id: leftover.id, quantity: 5, price: 200 },
    ],
    status: 'confirmed',
  }, 'test-user', 'main');

  const partial = svc.createDocument({
    type: 'inventory',
    date: '2026-08-27',
    to_department_id: deptId,
    inventory_coverage: 'partial',
    items: [{ product_id: counted.id, book_qty: 10, quantity: 8, unit_cost: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(partial.inventory_coverage, 'partial');
  assert.equal(getDepartmentStockWithCost(deptId, counted.id).stock, 8);
  assert.equal(getDepartmentStockWithCost(deptId, leftover.id).stock, 5);
  assert.equal(partial.remainder_document, null);
  svc.cancelDocument(partial.id, 'test-user');
  assert.equal(svc.getDocument(partial.id, 'main').status, 'draft');
  assert.equal(getDepartmentStockWithCost(deptId, counted.id).stock, 10);
  assert.equal(getDepartmentStockWithCost(deptId, leftover.id).stock, 5);
  svc.deleteDocument(partial.id);

  const articleId = cashArticleId('main', SHORTAGE_ARTICLE_CODE);
  assert.throws(
    () => svc.createDocument({
      type: 'inventory',
      date: '2026-08-28',
      to_department_id: deptId,
      inventory_coverage: 'full',
      items: [{ product_id: counted.id, book_qty: 10, quantity: 10, unit_cost: 100 }],
      status: 'confirmed',
    }, 'test-user', 'main'),
    /статью/,
  );

  const sklad = db.queryOne("SELECT id FROM users WHERE username = 'sklad'");
  const full = svc.createDocument({
    type: 'inventory',
    date: '2026-08-28',
    to_department_id: deptId,
    inventory_coverage: 'full',
    article_id: articleId,
    liable_user_id: sklad.id,
    items: [{ product_id: counted.id, book_qty: 10, quantity: 9, unit_cost: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(full.inventory_coverage, 'full');
  assert.equal(getDepartmentStockWithCost(deptId, counted.id).stock, 9);
  assert.equal(getDepartmentStockWithCost(deptId, leftover.id).stock, 0);
  assert.ok(full.remainder_document);
  assert.equal(full.remainder_document.status, 'confirmed');
  assert.equal(full.remainder_document.liable_user_id, sklad.id);
  assert.equal(full.remainder_document.article_id, articleId);
  assert.equal(full.remainder_document.total_amount, 1000);
  assert.equal(full.counted_amount, 900);
  assert.equal(full.remainder_amount, 1000);
  assert.equal(full.stock_amount, 1900);
  assert.equal(full.remainder_items.length, 1);
  assert.equal(full.remainder_items[0].product_id, leftover.id);
  assert.equal(full.remainder_items[0].product_name, 'Инв leftover');
  assert.equal(full.remainder_items[0].book_qty, 5);
  assert.equal(full.remainder_items[0].amount, 1000);

  const listed = svc.getDocuments({ branch_id: 'main', type: 'inventory' });
  assert.ok(listed.some((d) => d.id === full.id));
  assert.ok(!listed.some((d) => d.id === full.remainder_document.id));
  assert.equal(listed.find((d) => d.id === full.id)?.remainder_document?.id, full.remainder_document.id);

  const client = svc.createCounterparty({ name: 'Клиент инв', type: 'client', branch_id: 'main' });
  const debtors = svc.getDebtorsReport('main', true);
  assert.ok(!debtors.rows.some((r) => r.id === client.id && r.charged > 0));

  const pnl = svc.getPnLReport('main', '2026-08-01', '2026-08-31');
  const remExp = pnl.operating_expenses.items.find((i) => i.source === 'inventory_remainder');
  assert.ok(remExp);
  assert.equal(remExp.amount, 1000);
  const countedExp = pnl.operating_expenses.items.find((i) => i.source === 'inventory');
  assert.ok(countedExp);
  assert.equal(countedExp.amount, 100);

  const returnArticle = cashArticleId('main', DEBT_RETURN_ARTICLE_CODE);
  const pay = svc.createPayment({
    type: 'other_income',
    amount: 400,
    date: '2026-08-29',
    article_id: returnArticle,
    document_id: full.remainder_document.id,
  }, 'test-user', 'main');
  assert.equal(pay.document_id, full.remainder_document.id);
  assert.equal(pay.liable_user_id, sklad.id);
  const afterPay = svc.getDocument(full.id, 'main');
  assert.equal(afterPay.remainder_document.paid, 400);
  assert.equal(afterPay.remainder_document.balance, 600);

  svc.cancelDocument(full.id, 'test-user');
  assert.equal(getDepartmentStockWithCost(deptId, counted.id).stock, 10);
  assert.equal(getDepartmentStockWithCost(deptId, leftover.id).stock, 5);
  const unconfirmed = svc.getDocument(full.id, 'main');
  assert.equal(unconfirmed.status, 'draft');
  assert.equal(unconfirmed.remainder_document.status, 'cancelled');
  assert.ok(unconfirmed.remainder_items.some((item) => (
    item.product_id === leftover.id && item.book_qty === 5
  )));

  const edited = svc.updateDocument(full.id, {
    type: 'inventory',
    date: '2026-08-28',
    to_department_id: deptId,
    inventory_coverage: 'full',
    article_id: articleId,
    liable_user_id: sklad.id,
    items: [{ product_id: counted.id, book_qty: 10, quantity: 7, unit_cost: 100 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(edited.status, 'confirmed');
  assert.equal(getDepartmentStockWithCost(deptId, counted.id).stock, 7);
  assert.equal(getDepartmentStockWithCost(deptId, leftover.id).stock, 0);
  assert.ok(edited.remainder_document);
  assert.equal(edited.remainder_document.status, 'confirmed');
});

test('inventory: full leftover can hang on a department', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId, createDepartment } = await import('../departments.js');
  const { getDepartmentStockWithCost } = await import('../inventoryCost.js');
  const { cashArticleId, SHORTAGE_ARTICLE_CODE } = await import('../cashArticleDefaults.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = createDepartment({ name: 'Отдел покрытие долг', branch_id: 'main' }).id;
  const otherDept = createDepartment({ name: 'Кухня инв', branch_id: 'main' });
  const kept = svc.createProduct({
    name: 'Инв dept kept',
    sku: 'INV-DEPT-A',
    unit: 'кг',
    price: 50,
    branch_id: 'main',
  });
  const drop = svc.createProduct({
    name: 'Инв dept drop',
    sku: 'INV-DEPT-B',
    unit: 'кг',
    price: 80,
    branch_id: 'main',
  });
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [
      { product_id: kept.id, quantity: 2, price: 50 },
      { product_id: drop.id, quantity: 4, price: 80 },
    ],
    status: 'confirmed',
  }, 'test-user', 'main');

  const articleId = cashArticleId('main', SHORTAGE_ARTICLE_CODE);
  const full = svc.createDocument({
    type: 'inventory',
    date: '2026-08-28',
    to_department_id: deptId,
    inventory_coverage: 'full',
    article_id: articleId,
    liable_department_id: otherDept.id,
    items: [{ product_id: kept.id, book_qty: 2, quantity: 2, unit_cost: 50 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(getDepartmentStockWithCost(deptId, drop.id).stock, 0);
  assert.equal(full.remainder_document.liable_department_id, otherDept.id);
  assert.equal(full.remainder_document.liable_user_id, null);
  assert.equal(full.remainder_document.total_amount, 320);
});

test('inventory: net_weight fact is net × qty against warehouse book', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { createDepartment } = await import('../departments.js');
  const { getDepartmentStockWithCost } = await import('../inventoryCost.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = createDepartment({ name: 'Отдел инв нетто', branch_id: 'main' }).id;
  const product = svc.createProduct({
    name: 'Инв нетто',
    sku: 'INV-NET',
    unit: 'кг',
    price: 1000,
    net_weight: 0.5,
    branch_id: 'main',
  });

  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 20, price: 500, net_weight: 0.5 }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 10);

  const snap = svc.getInventoryStockSnapshot(deptId, 'main', product.id);
  assert.equal(snap[0].net_weight, 0.5);
  assert.equal(snap[0].book_qty, 10);

  const inv = svc.createDocument({
    type: 'inventory',
    date: '2026-08-28',
    to_department_id: deptId,
    items: [{
      product_id: product.id,
      book_qty: 10,
      quantity: 24,
      net_weight: 0.5,
      unit_cost: 1000,
    }],
    status: 'confirmed',
  }, 'test-user', 'main');

  assert.equal(inv.items[0].net_weight, 0.5);
  assert.equal(inv.items[0].quantity, 24);
  assert.equal(inv.surplus_total, 2000);
  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 12);
});

test('inventory draft keeps entered qty, net_weight and book_qty on save/reopen', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { createDepartment } = await import('../departments.js');
  const { getDepartmentStockWithCost } = await import('../inventoryCost.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = createDepartment({ name: 'Отдел инв черновик нетто', branch_id: 'main' }).id;
  const product = svc.createProduct({
    name: 'Инв черновик нетто',
    sku: 'INV-NET-DRAFT',
    unit: 'кг',
    price: 1000,
    net_weight: 0.5,
    branch_id: 'main',
  });
  svc.createDocument({
    type: 'prihod',
    date: '2026-08-20',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 20, price: 500, net_weight: 0.5 }],
    status: 'confirmed',
  }, 'test-user', 'main');
  assert.equal(getDepartmentStockWithCost(deptId, product.id).stock, 10);

  const draft = svc.createDocument({
    type: 'inventory',
    date: '2026-08-28',
    to_department_id: deptId,
    items: [{
      product_id: product.id,
      book_qty: 10,
      quantity: 18,
      net_weight: 0.5,
      unit_cost: 1000,
    }],
    status: 'draft',
  }, 'test-user', 'main');

  assert.equal(draft.status, 'draft');
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].quantity, 18);
  assert.equal(draft.items[0].book_qty, 10);
  assert.equal(draft.items[0].net_weight, 0.5);

  const updated = svc.updateDocument(draft.id, {
    type: 'inventory',
    date: '2026-08-28',
    to_department_id: deptId,
    items: [{
      product_id: product.id,
      book_qty: 10,
      quantity: 22,
      net_weight: 0.4,
      unit_cost: 1000,
    }],
    status: 'draft',
  }, 'test-user', 'main');

  assert.equal(updated.items[0].quantity, 22);
  assert.equal(updated.items[0].book_qty, 10);
  assert.equal(updated.items[0].net_weight, 0.4);

  const reopened = svc.getDocument(updated.id, 'main');
  assert.equal(reopened.items[0].quantity, 22);
  assert.equal(reopened.items[0].book_qty, 10);
  assert.equal(reopened.items[0].net_weight, 0.4);
});
