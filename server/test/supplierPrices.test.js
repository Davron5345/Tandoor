import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-supplier-prices-'));
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

test('supplier price document prefills product last_price; prihod confirm syncs price list', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');
  const {
    createSupplierPriceDocument,
    confirmSupplierPriceDocument,
    getSupplierPriceMap,
    listSupplierPriceDocuments,
  } = await import('../services/supplierPrices.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  const supplier = svc.createCounterparty({
    name: 'Поставщик Прайс',
    type: 'supplier',
    branch_id: 'main',
  });
  const product = svc.createProduct({
    name: 'Товар с прайсом',
    sku: 'SP-001',
    unit: 'шт',
    price: 1000,
    branch_id: 'main',
    supplier_ids: [supplier.id],
  });

  const priceDoc = createSupplierPriceDocument({
    date: '2026-07-20',
    counterparty_id: supplier.id,
    comment: 'Прайс июля',
    items: [{ product_id: product.id, price: 7777 }],
  }, 'test-user', 'main');
  confirmSupplierPriceDocument(priceDoc.id, 'test-user', 'main');

  const map = getSupplierPriceMap('main', supplier.id);
  assert.equal(map[product.id], 7777);

  const products = svc.getProducts({
    branch_id: 'main',
    last_doc_type: 'prihod',
    counterparty_id: supplier.id,
  });
  const row = products.find((p) => p.id === product.id);
  assert.ok(row);
  assert.equal(Number(row.last_price), 7777);

  const prihod = svc.createDocument({
    type: 'prihod',
    date: '2026-07-30',
    counterparty_id: supplier.id,
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 2, price: 8888 }],
    status: 'draft',
  }, 'test-user', 'main');
  svc.confirmDocument(prihod.id, 'test-user');

  const mapAfter = getSupplierPriceMap('main', supplier.id, '2026-07-30');
  assert.equal(mapAfter[product.id], 8888);

  const lists = listSupplierPriceDocuments('main');
  assert.ok(lists.some((d) => d.date === '2026-07-30' && d.counterparty_id === supplier.id && d.status === 'confirmed'));

  const productsAfter = svc.getProducts({
    branch_id: 'main',
    last_doc_type: 'prihod',
    counterparty_id: supplier.id,
  });
  const rowAfter = productsAfter.find((p) => p.id === product.id);
  assert.equal(Number(rowAfter.last_price), 8888);
});
