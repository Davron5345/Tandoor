import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), 'warehouse-zero-stock-'));
  process.env.DATA_DIR = testDir;
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.NODE_ENV = 'test';
});

after(() => {
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('zeroStockPosition clears orphan department stock', async () => {
  const { initDb } = await import('../db.js');
  await initDb();
  const db = await import('../db.js');
  const { zeroStockPosition } = await import('../services/reports.js');
  const { setDepartmentStock } = await import('../inventoryCost.js');

  const branchId = db.queryOne('SELECT id FROM branches LIMIT 1')?.id;
  const departmentId = db.queryOne('SELECT id FROM departments WHERE branch_id = ? LIMIT 1', [branchId])?.id;
  const productId = uuidv4();

  db.run('INSERT INTO products (id, name, unit) VALUES (?, ?, ?)', [
    productId, 'Test orphan stock', 'кг',
  ]);

  setDepartmentStock(departmentId, productId, 8, 135000);

  const result = zeroStockPosition(branchId, {
    department_id: departmentId,
    product_id: productId,
  });

  assert.equal(result.cleared_qty, 8);
  const row = db.queryOne(
    `SELECT stock FROM product_department_stock
     WHERE department_id = ? AND product_id = ? AND (variant_id IS NULL OR variant_id = '')`,
    [departmentId, productId],
  );
  assert.ok(!row || row.stock === 0);

  db.run('DELETE FROM product_department_stock WHERE product_id = ?', [productId]);
  db.run('DELETE FROM products WHERE id = ?', [productId]);
});
