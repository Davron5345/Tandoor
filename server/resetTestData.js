import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import db from './db.js';
import { backupDatabaseFile } from './dbBackup.js';
import { getUploadsRoot } from './productImages.js';

const { queryAll, queryOne, transaction, run } = db;

export function resetTestData() {
  const backup = backupDatabaseFile('before-reset');
  if (!backup) {
    throw new Error('Не удалось создать резервную копию перед очисткой');
  }

  const before = {
    documents: queryOne('SELECT COUNT(*) as c FROM documents').c,
    document_items: queryOne('SELECT COUNT(*) as c FROM document_items').c,
    products: queryOne('SELECT COUNT(*) as c FROM products').c,
    calculations: queryOne('SELECT COUNT(*) as c FROM calculations').c,
    payments: queryOne('SELECT COUNT(*) as c FROM payments').c,
    counterparties: queryOne('SELECT COUNT(*) as c FROM counterparties').c,
    telegram_messages: queryOne('SELECT COUNT(*) as c FROM telegram_messages').c,
  };

  const productIds = queryAll('SELECT id FROM products').map((r) => r.id);

  transaction(() => {
    run('DELETE FROM document_history');
    run('DELETE FROM document_items');
    run('DELETE FROM documents');
    run('DELETE FROM telegram_messages');
    run('DELETE FROM payments');
    run('DELETE FROM calculation_sources');
    run('DELETE FROM calculation_items');
    run('DELETE FROM calculations');
    run('DELETE FROM product_suppliers');
    run('DELETE FROM product_department_stock');
    run('DELETE FROM product_branch_stock');
    run('DELETE FROM product_images');
    run('DELETE FROM products');
  });

  const productsUploadDir = join(getUploadsRoot(), 'products');
  if (existsSync(productsUploadDir)) {
    rmSync(productsUploadDir, { recursive: true, force: true });
  }

  const after = {
    documents: queryOne('SELECT COUNT(*) as c FROM documents').c,
    document_items: queryOne('SELECT COUNT(*) as c FROM document_items').c,
    products: queryOne('SELECT COUNT(*) as c FROM products').c,
    calculations: queryOne('SELECT COUNT(*) as c FROM calculations').c,
    payments: queryOne('SELECT COUNT(*) as c FROM payments').c,
    counterparties: queryOne('SELECT COUNT(*) as c FROM counterparties').c,
    telegram_messages: queryOne('SELECT COUNT(*) as c FROM telegram_messages').c,
  };

  return { before, after, deletedProducts: productIds.length, backup: backup.filename };
}
