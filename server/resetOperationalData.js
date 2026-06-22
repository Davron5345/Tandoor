import db from './db.js';
import { backupDatabaseFile } from './dbBackup.js';

const { queryOne, transaction, run } = db;

/**
 * Удаляет операционные данные (документы, остатки, оплаты, заказы),
 * сохраняя справочники: товары, категории, контрагенты, филиалы, сотрудников.
 */
export function resetOperationalData() {
  const backup = backupDatabaseFile('before-operational-reset');
  if (!backup) {
    throw new Error('Не удалось создать резервную копию перед очисткой');
  }

  const count = (sql) => queryOne(sql).c;

  const before = {
    documents: count('SELECT COUNT(*) as c FROM documents'),
    document_items: count('SELECT COUNT(*) as c FROM document_items'),
    opening_balance_lines: count('SELECT COUNT(*) as c FROM opening_balance_lines'),
    payments: count('SELECT COUNT(*) as c FROM payments'),
    stock_rows: count('SELECT COUNT(*) as c FROM product_department_stock'),
    calculations: count('SELECT COUNT(*) as c FROM calculations'),
    shop_orders: count('SELECT COUNT(*) as c FROM shop_orders'),
    products: count('SELECT COUNT(*) as c FROM products'),
    counterparties: count('SELECT COUNT(*) as c FROM counterparties'),
    categories: count('SELECT COUNT(*) as c FROM product_categories'),
  };

  transaction(() => {
    run('DELETE FROM telegram_messages');
    run('DELETE FROM document_history');
    run('DELETE FROM opening_balance_lines');
    run('DELETE FROM document_items');
    run('DELETE FROM documents');
    run('DELETE FROM payments');
    run('DELETE FROM calculation_sources');
    run('DELETE FROM calculation_items');
    run('DELETE FROM calculations');
    run('DELETE FROM shop_order_items');
    run('DELETE FROM shop_orders');
    run('DELETE FROM product_department_stock');
    run('DELETE FROM product_branch_stock');
    run('UPDATE counterparties SET opening_balance = 0');
    run("UPDATE branch_opening_balances SET cash_balance = 0, as_of_date = NULL");
  });

  const after = {
    documents: count('SELECT COUNT(*) as c FROM documents'),
    document_items: count('SELECT COUNT(*) as c FROM document_items'),
    opening_balance_lines: count('SELECT COUNT(*) as c FROM opening_balance_lines'),
    payments: count('SELECT COUNT(*) as c FROM payments'),
    stock_rows: count('SELECT COUNT(*) as c FROM product_department_stock'),
    calculations: count('SELECT COUNT(*) as c FROM calculations'),
    shop_orders: count('SELECT COUNT(*) as c FROM shop_orders'),
    products: count('SELECT COUNT(*) as c FROM products'),
    counterparties: count('SELECT COUNT(*) as c FROM counterparties'),
    categories: count('SELECT COUNT(*) as c FROM product_categories'),
  };

  return { before, after, backup: backup.filename };
}
