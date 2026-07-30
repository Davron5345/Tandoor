import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-product-docs-'));
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

test('getDocuments product_id filter returns matching prihod line qty/price', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  assert.ok(deptId);

  const productA = svc.createProduct({
    name: 'Товар A',
    sku: 'PA-001',
    unit: 'шт',
    price: 1000,
    branch_id: 'main',
  });
  const productB = svc.createProduct({
    name: 'Товар B',
    sku: 'PB-001',
    unit: 'шт',
    price: 2000,
    branch_id: 'main',
  });

  const doc = svc.createDocument({
    type: 'prihod',
    date: '2026-07-30',
    to_department_id: deptId,
    items: [
      { product_id: productA.id, quantity: 3, price: 1500 },
      { product_id: productB.id, quantity: 7, price: 2500 },
    ],
    status: 'draft',
  }, 'test-user', 'main');

  svc.confirmDocument(doc.id, 'test-user');

  const rows = svc.getDocuments({
    branch_id: 'main',
    type: 'prihod',
    status: 'confirmed',
    product_id: productA.id,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, doc.id);
  assert.equal(Number(rows[0].quantity), 3);
  assert.equal(Number(rows[0].price), 1500);
  assert.equal(Number(rows[0].amount), 4500);

  const none = svc.getDocuments({
    branch_id: 'main',
    type: 'prihod',
    status: 'confirmed',
    product_id: 'missing-product',
  });
  assert.equal(none.length, 0);
});

test('getDocuments variant_id filter returns only that variant line', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId } = await import('../departments.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  assert.ok(deptId);

  const product = svc.createProduct({
    name: 'Мол',
    sku: 'MOL-VAR',
    unit: 'кг',
    category_id: 'other',
    branch_id: 'main',
    has_variants: true,
    variants: [
      { name: 'Суяк', price: 1000 },
      { name: 'Гушт', price: 2000 },
    ],
  });
  assert.equal(product.variants?.length, 2);
  const variantA = product.variants[0];
  const variantB = product.variants[1];

  const doc = svc.createDocument({
    type: 'prihod',
    date: '2026-07-30',
    to_department_id: deptId,
    items: [
      { product_id: product.id, variant_id: variantA.id, quantity: 2, price: 1000 },
      { product_id: product.id, variant_id: variantB.id, quantity: 5, price: 2000 },
    ],
    status: 'draft',
  }, 'test-user', 'main');
  svc.confirmDocument(doc.id, 'test-user');

  const allForProduct = svc.getDocuments({
    branch_id: 'main',
    type: 'prihod',
    status: 'confirmed',
    product_id: product.id,
  });
  assert.equal(allForProduct.length, 2);

  const onlyA = svc.getDocuments({
    branch_id: 'main',
    type: 'prihod',
    status: 'confirmed',
    product_id: product.id,
    variant_id: variantA.id,
  });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].id, doc.id);
  assert.equal(Number(onlyA[0].quantity), 2);
  assert.equal(Number(onlyA[0].price), 1000);

  const onlyB = svc.getDocuments({
    branch_id: 'main',
    type: 'prihod',
    status: 'confirmed',
    product_id: product.id,
    variant_id: variantB.id,
  });
  assert.equal(onlyB.length, 1);
  assert.equal(Number(onlyB[0].quantity), 5);
  assert.equal(Number(onlyB[0].price), 2000);
});
