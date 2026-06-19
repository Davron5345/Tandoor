import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  E2E_DATA_DIR,
  E2E_SUPPLIER_NAME,
  E2E_CLIENT_NAME,
  E2E_PRODUCT_NAME,
} from './constants.mjs';

export async function prepareE2eDatabase() {
  rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  mkdirSync(E2E_DATA_DIR, { recursive: true });
  mkdirSync(join(E2E_DATA_DIR, 'backups'), { recursive: true });

  process.env.DATA_DIR = E2E_DATA_DIR;
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_DEMO_SEED = 'true';
  process.env.TELEGRAM_ENABLED = 'false';

  const db = (await import('../server/db.js')).default;
  const { initPermissions } = await import('../server/permissions.js');
  const { seedDefaultUsers } = await import('../server/auth.js');

  await db.initDb();
  initPermissions(db);
  seedDefaultUsers();

  const { queryOne, run } = db;

  run("UPDATE users SET must_change_password = 0");

  const supplierId = 'e2e-supplier';
  if (!queryOne('SELECT id FROM counterparties WHERE id = ?', [supplierId])) {
    run(
      `INSERT INTO counterparties (id, name, type, phone, branch_id)
       VALUES (?, ?, 'supplier', '+998900000001', 'main')`,
      [supplierId, E2E_SUPPLIER_NAME],
    );
  }

  const productId = 'e2e-product';
  if (!queryOne('SELECT id FROM products WHERE id = ?', [productId])) {
    run(
      `INSERT INTO products (id, name, sku, unit, price, stock, category_id)
       VALUES (?, ?, 'E2E-001', 'шт', 1000, 0, 'other')`,
      [productId, E2E_PRODUCT_NAME],
    );
  }

  run('DELETE FROM product_suppliers WHERE product_id = ? AND branch_id = ?', [productId, 'main']);
  run(
    `INSERT INTO product_suppliers (id, product_id, supplier_id, branch_id)
     VALUES (?, ?, ?, 'main')`,
    [uuidv4(), productId, supplierId],
  );

  const clientId = 'e2e-client';
  if (!queryOne('SELECT id FROM counterparties WHERE id = ?', [clientId])) {
    run(
      `INSERT INTO counterparties (id, name, type, phone, branch_id)
       VALUES (?, ?, 'client', '+998900000002', 'main')`,
      [clientId, E2E_CLIENT_NAME],
    );
  }

  const { receiveDepartmentStock } = await import('../server/inventoryCost.js');
  const { syncBranchStockFromDepartments } = await import('../server/departments.js');
  receiveDepartmentStock('main_wh', productId, 10, 1000);
  syncBranchStockFromDepartments('main', productId);
}
