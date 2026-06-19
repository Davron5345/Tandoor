import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-test-'));
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

test('prihod document increases department stock on confirm', async () => {
  const { default: db, initDb } = await import('../db.js');
  const { initPermissions } = await import('../permissions.js');
  const { seedDefaultUsers } = await import('../auth.js');
  const svc = await import('../services.js');
  const { getDefaultDepartmentId, getDepartmentStock } = await import('../departments.js');
  const { getBranchStock } = await import('../branches.js');

  await initDb();
  initPermissions(db);
  seedDefaultUsers();

  const deptId = getDefaultDepartmentId('main');
  assert.ok(deptId, 'После initDb должен существовать отдел по умолчанию');

  const product = svc.createProduct({
    name: 'Тестовый товар',
    sku: 'TEST-001',
    unit: 'шт',
    price: 1000,
    branch_id: 'main',
  });

  const beforeStock = getDepartmentStock(product.id, deptId);
  const beforeBranchStock = getBranchStock(product.id, 'main');

  const doc = svc.createDocument({
    type: 'prihod',
    date: '2026-06-19',
    to_department_id: deptId,
    items: [{ product_id: product.id, quantity: 5, price: 1000 }],
    status: 'draft',
  }, 'test-user', 'main');

  const confirmed = svc.confirmDocument(doc.id, 'test-user');
  assert.equal(confirmed.status, 'confirmed');

  const afterStock = getDepartmentStock(product.id, deptId);
  const afterBranchStock = getBranchStock(product.id, 'main');
  assert.equal(afterStock, beforeStock + 5);
  assert.equal(afterBranchStock, beforeBranchStock + 5);

  svc.cancelDocument(doc.id, 'test-user');
  assert.equal(getDepartmentStock(product.id, deptId), beforeStock);
});

test('changePassword rejects weak passwords', async () => {
  const { changePassword } = await import('../auth.js');
  const db = (await import('../db.js')).default;

  const user = db.queryOne("SELECT * FROM users WHERE username = 'admin'");
  assert.ok(user);

  assert.throws(
    () => changePassword(user.id, 'admin123', 'admin123', 'token'),
    /простой/,
  );
});
