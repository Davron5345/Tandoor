import initSqlJs from 'sql.js';
import {
  LEGACY_ARTICLE_CODES,
  DEFAULT_CASH_ARTICLES,
  cashArticleId,
} from './cashArticleDefaults.js';
import { existsSync, readFileSync, statSync, mkdirSync } from 'fs';
import {
  dbPath, dataDir, backupDatabaseFile, writeDatabaseAtomic, listBackups,
} from './dbBackup.js';

let db = null;
let inTransaction = false;
let saveDeferred = false;

function saveDb() {
  if (!db || inTransaction || saveDeferred) return;
  writeDatabaseAtomic(Buffer.from(db.export()));
}

function backupBeforeMigrations() {
  if (!existsSync(dbPath)) return;
  const size = statSync(dbPath).size;
  if (size < 1) return;

  const recent = listBackups().find((b) => {
    const ageMs = Date.now() - new Date(b.created_at).getTime();
    return ageMs < 5 * 60 * 1000 && b.size === size;
  });
  if (recent) return;

  const created = backupDatabaseFile('pre-migration');
  if (created) {
    console.log(`💾 Резервная копия БД: ${created.filename}`);
  }
}

/**
 * Безопасная пересборка таблицы: проверка числа строк до/после, транзакция, откат при ошибке.
 */
function rebuildTableWithRowCheck({ table, createNewSql, settingKey, label = settingKey, insertSql = null }) {
  const beforeCount = queryOne(`SELECT COUNT(*) as c FROM ${table}`)?.c ?? 0;
  const cols = queryAll(`PRAGMA table_info(${table})`).map((c) => c.name);
  const colList = cols.join(', ');
  const copySql = insertSql || `INSERT INTO ${table}_new (${colList}) SELECT ${colList} FROM ${table}`;

  db.run(`DROP TABLE IF EXISTS ${table}_new`);

  try {
    transaction(() => {
      db.run(createNewSql);
      db.run(copySql);
      const afterCount = queryOne(`SELECT COUNT(*) as c FROM ${table}_new`)?.c ?? 0;
      if (afterCount !== beforeCount) {
        throw new Error(`${label}: потеря данных (${beforeCount} → ${afterCount} строк)`);
      }
      db.run(`DROP TABLE ${table}`);
      db.run(`ALTER TABLE ${table}_new RENAME TO ${table}`);
      run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')`, [settingKey]);
    });
  } catch (e) {
    try {
      db.run(`DROP TABLE IF EXISTS ${table}_new`);
    } catch {
      // ignore
    }
    throw e;
  }
}

export function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

export function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

export function transaction(fn) {
  inTransaction = true;
  db.run('BEGIN');
  try {
    fn();
    db.run('COMMIT');
    inTransaction = false;
    saveDb();
  } catch (e) {
    inTransaction = false;
    try {
      db.run('ROLLBACK');
    } catch {
      // transaction may already be closed
    }
    throw e;
  }
}

export function getDb() {
  return db;
}

export async function initDb() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs();

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT,
      unit TEXT DEFAULT 'шт',
      price REAL DEFAULT 0,
      stock REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS counterparties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('supplier', 'client')),
      phone TEXT,
      email TEXT,
      telegram_chat_id TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('prihod', 'rashod', 'return_supplier')),
      counterparty_id TEXT,
      source_document_id TEXT,
      date TEXT NOT NULL,
      comment TEXT,
      total_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed', 'cancelled')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (counterparty_id) REFERENCES counterparties(id),
      FOREIGN KEY (source_document_id) REFERENCES documents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS document_items (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS document_history (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      action TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      changed_by TEXT DEFAULT 'system',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS telegram_messages (
      id TEXT PRIMARY KEY,
      counterparty_id TEXT,
      document_id TEXT,
      chat_id TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (counterparty_id) REFERENCES counterparties(id),
      FOREIGN KEY (document_id) REFERENCES documents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_suppliers (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (supplier_id) REFERENCES counterparties(id) ON DELETE CASCADE,
      UNIQUE(product_id, supplier_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'warehouse', 'cashier')),
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('supplier_payment', 'customer_income', 'other_income', 'other_expense')),
      counterparty_id TEXT,
      document_id TEXT,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      comment TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (counterparty_id) REFERENCES counterparties(id),
      FOREIGN KEY (document_id) REFERENCES documents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (role, permission)
    )
  `);

  backupBeforeMigrations();
  saveDeferred = true;
  try {
    migrateSchema();
  } catch (e) {
    console.error('❌ Ошибка миграции БД:', e.message);
    console.error('💾 Восстановите из data/backups/ или npm run db:verify');
    throw e;
  } finally {
    saveDeferred = false;
  }
  seedIfEmpty();
  saveDb();

  if (existsSync(dbPath) && statSync(dbPath).size > 0) {
    backupDatabaseFile('startup');
  }

  return db;
}

function migrateSchema() {
  const cols = queryAll('PRAGMA table_info(documents)');
  const names = cols.map((c) => c.name);
  if (!names.includes('from_location')) {
    run('ALTER TABLE documents ADD COLUMN from_location TEXT');
  }
  if (!names.includes('to_location')) {
    run('ALTER TABLE documents ADD COLUMN to_location TEXT');
  }

  try {
    db.run(`INSERT INTO documents (id, number, type, date, total_amount, status)
      VALUES ('__migrate_test__', '__migrate_test__', 'peremeshchenie', '2026-01-01', 0, 'draft')`);
    db.run(`DELETE FROM documents WHERE id='__migrate_test__'`);
  } catch {
    migrateDocumentsTable();
  }

  migrateRolesAndUsers();
  migrateRolesFlexible();
  migrateBranches();
  migrateDepartments();
  migrateRazdelka();
  migrateCalculations();
  migrateCalculationsV2();
  migrateCalculationsVariants();
  migrateCounterpartiesBranch();
  migrateProductCategories();
  migrateProductImages();
  migrateProductVariants();
  migrateProductVariantStock();
  migrateProductVariantArchive();
  migrateProductArchive();
  migrateCounterpartyContracts();
  migrateDocNumberPerType();
  migrateReturnSupplierSourceDocument();
  migrateDepartmentAvgCost();
  migrateVariantDepartmentStock();
  migrateVariantDepartmentStockV2();
  migrateCashArticles();
  migrateCashArticlesBranch();
  migrateDocumentHistoryRetention();
  migrateMustChangePassword();
  migrateAuditLog();
  migrateProductBranches();
  migrateShopOrders();
}

function migrateShopOrders() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'shop_orders_v1'");
  if (done) return;

  run(`
    CREATE TABLE IF NOT EXISTS shop_orders (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      delivery_type TEXT NOT NULL DEFAULT 'pickup' CHECK(delivery_type IN ('pickup', 'delivery')),
      address TEXT,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'processing', 'done', 'cancelled')),
      total_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS shop_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      variant_id TEXT,
      product_name TEXT NOT NULL,
      variant_name TEXT,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      unit TEXT,
      line_total REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES shop_orders(id) ON DELETE CASCADE
    )
  `);

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_orders_v1', '1')");
}

function migrateProductBranches() {
  run(`
    CREATE TABLE IF NOT EXISTS product_branches (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      visible INTEGER NOT NULL DEFAULT 1,
      price REAL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(product_id, branch_id)
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS product_variant_branches (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      price REAL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(variant_id, branch_id)
    )
  `);
  run('CREATE INDEX IF NOT EXISTS idx_product_branches_branch ON product_branches(branch_id, visible)');
  run('CREATE INDEX IF NOT EXISTS idx_product_branches_product ON product_branches(product_id)');

  const done = queryOne("SELECT value FROM settings WHERE key = 'product_branches_v1'");
  if (done) return;

  const products = queryAll('SELECT id FROM products');
  const branches = queryAll('SELECT id FROM branches');
  for (const product of products) {
    for (const branch of branches) {
      run(
        `INSERT OR IGNORE INTO product_branches (id, product_id, branch_id, visible, price)
         VALUES (?, ?, ?, 1, NULL)`,
        [uuidv4(), product.id, branch.id],
      );
    }
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('product_branches_v1', '1')");
}

function migrateAuditLog() {
  run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run('CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC)');
  run('CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)');
}

function migrateMustChangePassword() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'must_change_pwd_v1'");
  if (done) return;

  const userCols = queryAll('PRAGMA table_info(users)').map((c) => c.name);
  if (!userCols.includes('must_change_password')) {
    run('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0');
  }

  if (process.env.NODE_ENV === 'production') {
    run(
      "UPDATE users SET must_change_password = 1 WHERE LOWER(username) = 'admin' AND role = 'admin'",
    );
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('must_change_pwd_v1', '1')");
  saveDb();
}

function migrateDocumentHistoryRetention() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'document_history_retain_v1'");
  if (done) return;

  const fkRows = queryAll('PRAGMA foreign_key_list(document_history)');
  const hasCascade = fkRows.some((fk) => (
    fk.table === 'documents'
    && String(fk.on_delete || '').toUpperCase() === 'CASCADE'
  ));

  if (hasCascade) {
    rebuildTableWithRowCheck({
      table: 'document_history',
      settingKey: 'document_history_retain_v1',
      label: 'document_history_retain_v1',
      createNewSql: `
        CREATE TABLE document_history_new (
          id TEXT PRIMARY KEY,
          document_id TEXT,
          action TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          changed_by TEXT DEFAULT 'system',
          created_at TEXT DEFAULT (datetime('now'))
        )
      `,
    });
    run('CREATE INDEX IF NOT EXISTS idx_document_history_document ON document_history(document_id)');
    return;
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('document_history_retain_v1', '1')");
  saveDb();
}

function migrateVariantDepartmentStockV2() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'variant_department_stock_v2'");
  if (done) return;

  backupDatabaseFile('migration-pds-v2');
  const beforeCount = queryOne('SELECT COUNT(*) as c FROM product_department_stock')?.c ?? 0;
  run(`
    DELETE FROM product_department_stock
    WHERE (variant_id IS NULL OR variant_id = '')
      AND product_id IN (SELECT id FROM products WHERE COALESCE(has_variants, 0) = 1)
  `);

  run(`
    CREATE TABLE product_department_stock_new (
      id TEXT PRIMARY KEY,
      department_id TEXT NOT NULL REFERENCES departments(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      variant_id TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
      stock REAL DEFAULT 0,
      avg_cost REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  run(`
    INSERT INTO product_department_stock_new
      (id, department_id, product_id, variant_id, stock, avg_cost, updated_at)
    SELECT id, department_id, product_id, variant_id, stock, COALESCE(avg_cost, 0), updated_at
    FROM product_department_stock
  `);

  const afterCount = queryOne('SELECT COUNT(*) as c FROM product_department_stock_new')?.c ?? 0;
  if (afterCount < beforeCount) {
    throw new Error(`variant_department_stock_v2: потеря строк (${beforeCount} → ${afterCount})`);
  }

  run('DROP TABLE product_department_stock');
  run('ALTER TABLE product_department_stock_new RENAME TO product_department_stock');

  run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pds_dept_product_variant
    ON product_department_stock(department_id, product_id, IFNULL(variant_id, ''))`);

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('variant_department_stock_v2', '1')");
  saveDb();
}

function migrateVariantDepartmentStock() {
  const pdsCols = queryAll('PRAGMA table_info(product_department_stock)').map((c) => c.name);
  if (!pdsCols.includes('variant_id')) {
    run('ALTER TABLE product_department_stock ADD COLUMN variant_id TEXT REFERENCES product_variants(id) ON DELETE CASCADE');
  }

  run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pds_dept_product_variant
    ON product_department_stock(department_id, product_id, IFNULL(variant_id, ''))`);

  const done = queryOne("SELECT value FROM settings WHERE key = 'variant_department_stock_v1'");
  if (done) return;

  const variants = queryAll(`
    SELECT pv.id, pv.product_id, pv.stock, pv.price, p.id as pid
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE COALESCE(pv.stock, 0) != 0
  `);

  for (const variant of variants) {
    const defaultDept = queryOne(`
      SELECT id FROM departments
      WHERE branch_id = 'main' AND active = 1
      ORDER BY id = 'main_wh' DESC, name
      LIMIT 1
    `);
    if (!defaultDept) continue;

    const existing = queryOne(
      `SELECT id FROM product_department_stock
       WHERE department_id = ? AND product_id = ? AND variant_id = ?`,
      [defaultDept.id, variant.product_id, variant.id],
    );
    if (existing) continue;

    run(
      `INSERT INTO product_department_stock (id, department_id, product_id, variant_id, stock, avg_cost)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), defaultDept.id, variant.product_id, variant.id, variant.stock, variant.price || 0],
    );
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('variant_department_stock_v1', '1')");
  saveDb();
}

function migrateDepartmentAvgCost() {
  const pdsCols = queryAll('PRAGMA table_info(product_department_stock)').map((c) => c.name);
  if (!pdsCols.includes('avg_cost')) {
    run('ALTER TABLE product_department_stock ADD COLUMN avg_cost REAL DEFAULT 0');
  }

  const done = queryOne("SELECT value FROM settings WHERE key = 'department_avg_cost_v1'");
  if (done) return;

  const rows = queryAll(`
    SELECT pds.department_id, pds.product_id, pds.stock, p.price
    FROM product_department_stock pds
    JOIN products p ON p.id = pds.product_id
    WHERE pds.stock != 0 AND COALESCE(pds.avg_cost, 0) = 0
  `);
  for (const row of rows) {
    run(
      'UPDATE product_department_stock SET avg_cost = ? WHERE department_id = ? AND product_id = ?',
      [row.price || 0, row.department_id, row.product_id],
    );
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('department_avg_cost_v1', '1')");
  saveDb();
}

function migrateProductVariants() {
  const prodCols = queryAll('PRAGMA table_info(products)').map((c) => c.name);
  if (!prodCols.includes('has_variants')) {
    run('ALTER TABLE products ADD COLUMN has_variants INTEGER DEFAULT 0');
  }

  run(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const imgCols = queryAll('PRAGMA table_info(product_images)').map((c) => c.name);
  if (!imgCols.includes('variant_id')) {
    run('ALTER TABLE product_images ADD COLUMN variant_id TEXT REFERENCES product_variants(id) ON DELETE CASCADE');
  }

  const done = queryOne("SELECT value FROM settings WHERE key = 'product_variants_v1'");
  if (!done) {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('product_variants_v1', '1')");
    saveDb();
  }
}

function migrateProductVariantArchive() {
  const variantCols = queryAll('PRAGMA table_info(product_variants)').map((c) => c.name);
  if (!variantCols.includes('archived')) {
    run('ALTER TABLE product_variants ADD COLUMN archived INTEGER DEFAULT 0');
  }
}

function migrateProductArchive() {
  const prodCols = queryAll('PRAGMA table_info(products)').map((c) => c.name);
  if (!prodCols.includes('archived')) {
    run('ALTER TABLE products ADD COLUMN archived INTEGER DEFAULT 0');
  }
}

function migrateProductVariantStock() {
  const variantCols = queryAll('PRAGMA table_info(product_variants)').map((c) => c.name);
  if (!variantCols.includes('stock')) {
    run('ALTER TABLE product_variants ADD COLUMN stock REAL DEFAULT 0');
  }

  const itemCols = queryAll('PRAGMA table_info(document_items)').map((c) => c.name);
  if (!itemCols.includes('variant_id')) {
    run('ALTER TABLE document_items ADD COLUMN variant_id TEXT REFERENCES product_variants(id)');
  }

  const done = queryOne("SELECT value FROM settings WHERE key = 'product_variant_stock_v1'");
  if (!done) {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('product_variant_stock_v1', '1')");
    saveDb();
  }
}

function migrateCounterpartyContracts() {
  run(`
    CREATE TABLE IF NOT EXISTS counterparty_contracts (
      id TEXT PRIMARY KEY,
      counterparty_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      number TEXT NOT NULL,
      date TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE CASCADE
    )
  `);

  const docCols = queryAll('PRAGMA table_info(documents)').map((c) => c.name);
  if (!docCols.includes('contract_id')) {
    run('ALTER TABLE documents ADD COLUMN contract_id TEXT REFERENCES counterparty_contracts(id)');
  }

  const done = queryOne("SELECT value FROM settings WHERE key = 'counterparty_contracts_v1'");
  if (!done) {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('counterparty_contracts_v1', '1')");
    saveDb();
  }
}

function migrateReturnSupplierSourceDocument() {
  const cols = queryAll('PRAGMA table_info(documents)').map((c) => c.name);
  if (!cols.includes('source_document_id')) {
    run('ALTER TABLE documents ADD COLUMN source_document_id TEXT REFERENCES documents(id)');
  }
  run('CREATE INDEX IF NOT EXISTS idx_documents_source_document ON documents(source_document_id)');

  const done = queryOne("SELECT value FROM settings WHERE key = 'return_supplier_source_doc_v1'");
  if (!done) {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('return_supplier_source_doc_v1', '1')");
    saveDb();
  }
}

function migrateDocNumberPerType() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'doc_number_per_type_v1'");
  if (done) return;

  backupDatabaseFile('migration-doc-number');

  run("UPDATE documents SET branch_id = COALESCE(NULLIF(branch_id, ''), NULLIF(from_branch_id, ''), 'main')");

  rebuildTableWithRowCheck({
    table: 'documents',
    label: 'doc_number_per_type_v1',
    settingKey: 'doc_number_per_type_v1',
    createNewSql: `
      CREATE TABLE documents_new (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL,
        type TEXT NOT NULL,
        counterparty_id TEXT,
        contract_id TEXT,
        source_document_id TEXT,
        date TEXT NOT NULL,
        comment TEXT,
        from_location TEXT,
        to_location TEXT,
        branch_id TEXT,
        from_branch_id TEXT,
        to_branch_id TEXT,
        from_department_id TEXT,
        to_department_id TEXT,
        total_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'draft',
        calculation_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(branch_id, type, number)
      )
    `,
  });
}

function migrateProductImages() {
  db.run(`
    CREATE TABLE IF NOT EXISTS product_images (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('photo', 'gif')),
      size INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  const done = queryOne("SELECT value FROM settings WHERE key = 'product_images_v1'");
  if (!done) {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('product_images_v1', '1')");
    saveDb();
  }

  const cols = queryAll('PRAGMA table_info(product_images)').map((c) => c.name);
  if (!cols.includes('is_primary')) {
    run('ALTER TABLE product_images ADD COLUMN is_primary INTEGER DEFAULT 0');
    saveDb();
  }
}

function migrateProductCategories() {
  db.run(`
    CREATE TABLE IF NOT EXISTS product_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const prodCols = queryAll('PRAGMA table_info(products)').map((c) => c.name);
  if (!prodCols.includes('category_id')) {
    run('ALTER TABLE products ADD COLUMN category_id TEXT REFERENCES product_categories(id)');
  }
  if (!prodCols.includes('barcode')) {
    run('ALTER TABLE products ADD COLUMN barcode TEXT');
  }
  if (!prodCols.includes('net_weight')) {
    run('ALTER TABLE products ADD COLUMN net_weight REAL');
  }
  if (!prodCols.includes('gross_weight')) {
    run('ALTER TABLE products ADD COLUMN gross_weight REAL');
  }

  const done = queryOne("SELECT value FROM settings WHERE key = 'product_categories_v1'");
  if (!done) {
    run("INSERT OR IGNORE INTO product_categories (id, name, sort_order) VALUES ('other', 'Прочее', 999)");
    run("INSERT OR IGNORE INTO product_categories (id, name, sort_order) VALUES ('electronics', 'Электроника', 1)");
    run("UPDATE products SET category_id = 'other' WHERE category_id IS NULL OR category_id = ''");
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('product_categories_v1', '1')");
    saveDb();
  }

  migrateProductSubcategories();
}

function migrateProductSubcategories() {
  const cols = queryAll('PRAGMA table_info(product_categories)').map((c) => c.name);
  if (!cols.includes('parent_id')) {
    run('ALTER TABLE product_categories ADD COLUMN parent_id TEXT REFERENCES product_categories(id)');
    saveDb();
  }

  const done = queryOne("SELECT value FROM settings WHERE key = 'product_subcategories_v1'");
  if (done) return;

  db.run(`
    CREATE TABLE product_categories_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES product_categories(id),
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`
    INSERT INTO product_categories_new (id, name, parent_id, sort_order, created_at)
    SELECT id, name, NULL, sort_order, created_at FROM product_categories
  `);
  run('DROP TABLE product_categories');
  run('ALTER TABLE product_categories_new RENAME TO product_categories');
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('product_subcategories_v1', '1')");
  saveDb();
}

function migrateCounterpartiesBranch() {
  const cpCols = queryAll('PRAGMA table_info(counterparties)').map((c) => c.name);
  if (!cpCols.includes('branch_id')) {
    run('ALTER TABLE counterparties ADD COLUMN branch_id TEXT REFERENCES branches(id)');
  }

  const psCols = queryAll('PRAGMA table_info(product_suppliers)').map((c) => c.name);
  if (!psCols.includes('branch_id')) {
    run('ALTER TABLE product_suppliers ADD COLUMN branch_id TEXT REFERENCES branches(id)');
  }

  const done = queryOne("SELECT value FROM settings WHERE key = 'counterparties_branch_v1'");
  if (done) return;

  run("UPDATE counterparties SET branch_id = 'main' WHERE branch_id IS NULL OR branch_id = ''");
  run("UPDATE product_suppliers SET branch_id = 'main' WHERE branch_id IS NULL OR branch_id = ''");
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('counterparties_branch_v1', '1')");
  saveDb();
}

function migrateBranches() {
  db.run(`
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_branch_stock (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      stock REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(branch_id, product_id)
    )
  `);

  const done = queryOne("SELECT value FROM settings WHERE key = 'branches_v1'");
  if (done) return;

  const mainExists = queryOne('SELECT id FROM branches WHERE id = ?', ['main']);
  if (!mainExists) {
    run('INSERT INTO branches (id, name, address, active) VALUES (?, ?, ?, 1)', ['main', 'Главный филиал', '']);
  }

  const userCols = queryAll('PRAGMA table_info(users)').map((c) => c.name);
  if (!userCols.includes('branch_id')) {
    run('ALTER TABLE users ADD COLUMN branch_id TEXT REFERENCES branches(id)');
  }

  const docCols = queryAll('PRAGMA table_info(documents)').map((c) => c.name);
  if (!docCols.includes('branch_id')) {
    run('ALTER TABLE documents ADD COLUMN branch_id TEXT REFERENCES branches(id)');
  }
  if (!docCols.includes('from_branch_id')) {
    run('ALTER TABLE documents ADD COLUMN from_branch_id TEXT REFERENCES branches(id)');
  }
  if (!docCols.includes('to_branch_id')) {
    run('ALTER TABLE documents ADD COLUMN to_branch_id TEXT REFERENCES branches(id)');
  }

  const payCols = queryAll('PRAGMA table_info(payments)').map((c) => c.name);
  if (!payCols.includes('branch_id')) {
    run('ALTER TABLE payments ADD COLUMN branch_id TEXT REFERENCES branches(id)');
  }

  run("UPDATE documents SET branch_id = 'main' WHERE branch_id IS NULL OR branch_id = ''");
  run("UPDATE payments SET branch_id = 'main' WHERE branch_id IS NULL OR branch_id = ''");

  const products = queryAll('SELECT id, stock FROM products');
  for (const p of products) {
    const existing = queryOne(
      'SELECT id FROM product_branch_stock WHERE branch_id = ? AND product_id = ?',
      ['main', p.id],
    );
    if (!existing) {
      run(
        'INSERT INTO product_branch_stock (id, branch_id, product_id, stock) VALUES (?, ?, ?, ?)',
        [uuidv4(), 'main', p.id, p.stock || 0],
      );
    }
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('branches_v1', '1')");
  saveDb();
}

function migrateDepartments() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'departments_v1'");
  if (done) return;

  run(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS product_department_stock (
      id TEXT PRIMARY KEY,
      department_id TEXT NOT NULL REFERENCES departments(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      stock REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(department_id, product_id)
    )
  `);

  const docCols = queryAll('PRAGMA table_info(documents)').map((c) => c.name);
  if (!docCols.includes('from_department_id')) {
    run('ALTER TABLE documents ADD COLUMN from_department_id TEXT REFERENCES departments(id)');
  }
  if (!docCols.includes('to_department_id')) {
    run('ALTER TABLE documents ADD COLUMN to_department_id TEXT REFERENCES departments(id)');
  }

  run("INSERT OR IGNORE INTO departments (id, branch_id, name, active) VALUES ('main_wh', 'main', 'Склад', 1)");

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('departments_v1', '1')");
  saveDb();
}

function migrateRazdelka() {
  const itemCols = queryAll('PRAGMA table_info(document_items)').map((c) => c.name);
  if (!itemCols.includes('item_role')) {
    run("ALTER TABLE document_items ADD COLUMN item_role TEXT DEFAULT 'input'");
    run("UPDATE document_items SET item_role = 'input' WHERE item_role IS NULL OR item_role = ''");
  }
  if (!itemCols.includes('toza')) {
    run('ALTER TABLE document_items ADD COLUMN toza REAL DEFAULT 0');
  }
  if (!itemCols.includes('qiymali')) {
    run('ALTER TABLE document_items ADD COLUMN qiymali REAL DEFAULT 0');
  }
  if (!itemCols.includes('otkhod')) {
    run('ALTER TABLE document_items ADD COLUMN otkhod REAL DEFAULT 0');
  }

  try {
    db.run(`INSERT INTO documents (id, number, type, date, total_amount, status)
      VALUES ('__migrate_razdelka__', '__migrate_razdelka__', 'razdelka', '2026-01-01', 0, 'draft')`);
    db.run(`DELETE FROM documents WHERE id='__migrate_razdelka__'`);
  } catch {
    migrateDocumentsTableRazdelka();
  }

  run("INSERT OR IGNORE INTO departments (id, branch_id, name, active) VALUES ('razdel_cn', 'main', 'Разделочный цех', 1)");

  const done = queryOne("SELECT value FROM settings WHERE key = 'razdelka_v1'");
  if (!done) {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('razdelka_v1', '1')");
    saveDb();
  }
}

function migrateCalculations() {
  run(`
    CREATE TABLE IF NOT EXISTS calculations (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      name TEXT NOT NULL,
      source_product_id TEXT NOT NULL REFERENCES products(id),
      base_quantity REAL DEFAULT 1,
      active INTEGER DEFAULT 1,
      comment TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS calculation_items (
      id TEXT PRIMARY KEY,
      calculation_id TEXT NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL,
      price REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    )
  `);

  const done = queryOne("SELECT value FROM settings WHERE key = 'calculations_v1'");
  if (!done) {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('calculations_v1', '1')");
    saveDb();
  }
}

function migrateCalculationsV2() {
  run(`
    CREATE TABLE IF NOT EXISTS calculation_sources (
      id TEXT PRIMARY KEY,
      calculation_id TEXT NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    )
  `);

  const itemCols = queryAll('PRAGMA table_info(calculation_items)').map((c) => c.name);
  if (!itemCols.includes('is_waste')) {
    run('ALTER TABLE calculation_items ADD COLUMN is_waste INTEGER DEFAULT 0');
  }

  const docCols = queryAll('PRAGMA table_info(documents)').map((c) => c.name);
  if (!docCols.includes('calculation_id')) {
    run('ALTER TABLE documents ADD COLUMN calculation_id TEXT REFERENCES calculations(id)');
  }

  const calcs = queryAll('SELECT id, source_product_id, base_quantity FROM calculations');
  for (const calc of calcs) {
    const hasSources = queryOne(
      'SELECT 1 as ok FROM calculation_sources WHERE calculation_id = ? LIMIT 1',
      [calc.id],
    );
    if (!hasSources && calc.source_product_id) {
      run(`
        INSERT INTO calculation_sources (id, calculation_id, product_id, quantity, sort_order)
        VALUES (?, ?, ?, ?, 0)
      `, [uuidv4(), calc.id, calc.source_product_id, calc.base_quantity || 1]);
    }
  }

  const done = queryOne("SELECT value FROM settings WHERE key = 'calculations_v2'");
  if (!done) {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('calculations_v2', '1')");
    saveDb();
  }
}

function migrateCalculationsVariants() {
  const srcCols = queryAll('PRAGMA table_info(calculation_sources)').map((c) => c.name);
  if (!srcCols.includes('variant_id')) {
    run('ALTER TABLE calculation_sources ADD COLUMN variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL');
  }

  const itemCols = queryAll('PRAGMA table_info(calculation_items)').map((c) => c.name);
  if (!itemCols.includes('variant_id')) {
    run('ALTER TABLE calculation_items ADD COLUMN variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL');
  }

  const done = queryOne("SELECT value FROM settings WHERE key = 'calculations_variants_v1'");
  if (done) return;

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('calculations_variants_v1', '1')");
  saveDb();
}

function migrateDocumentsTableRazdelka() {
  const hasSourceDoc = queryAll('PRAGMA table_info(documents)').some((c) => c.name === 'source_document_id');
  db.run(`
    CREATE TABLE documents_new (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('prihod', 'rashod', 'return_supplier', 'peremeshchenie', 'razdelka')),
      counterparty_id TEXT,
      source_document_id TEXT,
      date TEXT NOT NULL,
      comment TEXT,
      from_location TEXT,
      to_location TEXT,
      branch_id TEXT REFERENCES branches(id),
      from_branch_id TEXT REFERENCES branches(id),
      to_branch_id TEXT REFERENCES branches(id),
      from_department_id TEXT REFERENCES departments(id),
      to_department_id TEXT REFERENCES departments(id),
      total_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed', 'cancelled')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (counterparty_id) REFERENCES counterparties(id)
    )
  `);
  db.run(`
    INSERT INTO documents_new (
      id, number, type, counterparty_id, date, comment, from_location, to_location,
      branch_id, from_branch_id, to_branch_id, from_department_id, to_department_id, source_document_id,
      total_amount, status, created_at, updated_at
    )
    SELECT
      id, number, type, counterparty_id, date, comment, from_location, to_location,
      branch_id, from_branch_id, to_branch_id, from_department_id, to_department_id, ${hasSourceDoc ? 'source_document_id' : 'NULL'},
      total_amount, status, created_at, updated_at
    FROM documents
  `);
  db.run('DROP TABLE documents');
  db.run('ALTER TABLE documents_new RENAME TO documents');
  saveDb();
}

function migrateCashArticles() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'cash_articles_v1'");
  if (done) return;

  run(`
    CREATE TABLE IF NOT EXISTS cash_articles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('income', 'expense')),
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    )
  `);

  const payCols = queryAll('PRAGMA table_info(payments)').map((c) => c.name);
  if (!payCols.includes('article_id')) {
    run('ALTER TABLE payments ADD COLUMN article_id TEXT REFERENCES cash_articles(id)');
  }

  const incomeArticles = [
    ['ca_inc_sales', 'Выручка', 1],
    ['ca_inc_return', 'Возврат', 2],
    ['ca_inc_other', 'Прочий приход', 3],
  ];
  const expenseArticles = [
    ['ca_exp_purchase', 'Закуп', 1],
    ['ca_exp_salary', 'Зарплата', 2],
    ['ca_exp_rent', 'Аренда', 3],
    ['ca_exp_household', 'Хозрасходы', 4],
    ['ca_exp_other', 'Прочий расход', 5],
  ];

  for (const [id, name, sort] of incomeArticles) {
    run(
      'INSERT OR IGNORE INTO cash_articles (id, name, direction, sort_order, active) VALUES (?, ?, ?, ?, 1)',
      [id, name, 'income', sort],
    );
  }
  for (const [id, name, sort] of expenseArticles) {
    run(
      'INSERT OR IGNORE INTO cash_articles (id, name, direction, sort_order, active) VALUES (?, ?, ?, ?, 1)',
      [id, name, 'expense', sort],
    );
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('cash_articles_v1', '1')");
  saveDb();
}

function migrateCashArticlesBranch() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'cash_articles_branch_v1'");
  if (done) return;

  const cols = queryAll('PRAGMA table_info(cash_articles)').map((c) => c.name);
  if (!cols.includes('branch_id')) {
    run('ALTER TABLE cash_articles ADD COLUMN branch_id TEXT REFERENCES branches(id)');
  }
  if (!cols.includes('code')) {
    run('ALTER TABLE cash_articles ADD COLUMN code TEXT');
  }

  db.run('PRAGMA foreign_keys = OFF');
  try {
    for (const [legacyId, code] of Object.entries(LEGACY_ARTICLE_CODES)) {
      run("UPDATE cash_articles SET branch_id = 'main', code = ? WHERE id = ?", [code, legacyId]);
    }
    run("UPDATE cash_articles SET branch_id = 'main' WHERE branch_id IS NULL OR branch_id = ''");

    const branches = queryAll('SELECT id FROM branches');
    for (const branch of branches) {
      for (const article of DEFAULT_CASH_ARTICLES) {
        const id = cashArticleId(branch.id, article.code);
        run(
          `INSERT OR IGNORE INTO cash_articles
            (id, name, direction, sort_order, active, branch_id, code)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
          [id, article.name, article.direction, article.sort_order, branch.id, article.code],
        );
      }
    }

    for (const [legacyId, code] of Object.entries(LEGACY_ARTICLE_CODES)) {
      run(
        `UPDATE payments
         SET article_id = COALESCE(NULLIF(branch_id, ''), 'main') || '__' || ?
         WHERE article_id = ?`,
        [code, legacyId],
      );
    }

    for (const [legacyId] of Object.entries(LEGACY_ARTICLE_CODES)) {
      const refs = queryOne('SELECT COUNT(*) as c FROM payments WHERE article_id = ?', [legacyId])?.c ?? 0;
      if (refs === 0) {
        run('DELETE FROM cash_articles WHERE id = ?', [legacyId]);
      }
    }

    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('cash_articles_branch_v1', '1')");
  } finally {
    db.run('PRAGMA foreign_keys = ON');
  }
}

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function migrateRolesFlexible() {
  const done = queryOne("SELECT value FROM settings WHERE key = 'roles_flexible_v1'");
  if (done) return;
  run("UPDATE roles SET is_system = 0 WHERE id != 'admin'");
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('roles_flexible_v1', '1')");
  saveDb();
}

function migrateRolesAndUsers() {
  db.run(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT DEFAULT '',
      is_system INTEGER DEFAULT 0
    )
  `);

  const migrated = queryOne("SELECT value FROM settings WHERE key = 'users_role_v2'");
  if (!migrated) {
    migrateUsersTableWithoutRoleCheck();
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('users_role_v2', '1')");
    saveDb();
  }
}

function migrateUsersTableWithoutRoleCheck() {
  db.run(`
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    INSERT INTO users_new (id, username, password_hash, name, role, active, created_at)
    SELECT id, username, password_hash, name, role, active, created_at FROM users
  `);
  db.run('DROP TABLE users');
  db.run('ALTER TABLE users_new RENAME TO users');
}

function migrateDocumentsTable() {
  const hasSourceDoc = queryAll('PRAGMA table_info(documents)').some((c) => c.name === 'source_document_id');
  db.run(`
    CREATE TABLE documents_new (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('prihod', 'rashod', 'return_supplier', 'peremeshchenie')),
      counterparty_id TEXT,
      source_document_id TEXT,
      date TEXT NOT NULL,
      comment TEXT,
      from_location TEXT,
      to_location TEXT,
      total_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed', 'cancelled')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (counterparty_id) REFERENCES counterparties(id)
    )
  `);
  db.run(`
    INSERT INTO documents_new (id, number, type, counterparty_id, source_document_id, date, comment, from_location, to_location, total_amount, status, created_at, updated_at)
    SELECT id, number, type, counterparty_id, ${hasSourceDoc ? 'source_document_id' : 'NULL'}, date, comment, NULL, NULL, total_amount, status, created_at, updated_at FROM documents
  `);
  db.run('DROP TABLE documents');
  db.run('ALTER TABLE documents_new RENAME TO documents');
  saveDb();
}

function isDemoSeedDisabled() {
  if (process.env.DISABLE_DEMO_SEED === '1' || process.env.DISABLE_DEMO_SEED === 'true') return true;
  return process.env.NODE_ENV === 'production';
}

function seedIfEmpty() {
  const seeded = queryOne("SELECT value FROM settings WHERE key = 'demo_seed_done'");
  if (seeded) return;

  const productCount = queryOne('SELECT COUNT(*) as c FROM products').c;
  const counterpartyCount = queryOne('SELECT COUNT(*) as c FROM counterparties').c;
  if (productCount > 0 || counterpartyCount > 0) {
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_seed_done', '1')");
    saveDb();
    return;
  }

  const richBackup = listBackups().find((b) => b.size > 260000);
  if (richBackup) {
    console.warn('');
    console.warn('⚠️  База пустая, но в data/backups/ есть копия с вашими данными:');
    console.warn(`    ${richBackup.filename}`);
    console.warn('    Восстановите: npm run db:restore -- best');
    console.warn('');
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_seed_done', '1')");
    saveDb();
    return;
  }

  if (isDemoSeedDisabled()) {
    console.warn('');
    console.warn('⚠️  База пустая. Демо-данные не загружаются (production / DISABLE_DEMO_SEED).');
    console.warn(`    Файл БД: ${dbPath}`);
    console.warn('    Укажите DATA_DIR на постоянный диск или восстановите бэкап.');
    console.warn('');
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_seed_done', '1')");
    saveDb();
    return;
  }

  const products = [
    ['p1', 'Ноутбук Dell', 'NB-001', 'шт', 8500000, 10],
    ['p2', 'Мышь Logitech', 'MS-002', 'шт', 150000, 50],
    ['p3', 'Клавиатура', 'KB-003', 'шт', 350000, 30],
    ['p4', 'Монитор 24"', 'MN-004', 'шт', 2200000, 15],
    ['p5', 'USB-кабель', 'CB-005', 'шт', 25000, 100],
  ];
  for (const p of products) {
    run('INSERT INTO products (id, name, sku, unit, price, stock) VALUES (?, ?, ?, ?, ?, ?)', p);
  }

  run(`INSERT INTO counterparties (id, name, type, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)`,
    ['c1', 'ООО "ТехноСнаб"', 'supplier', '+998901234567', 'supply@tech.uz', 'Ташкент']);
  run(`INSERT INTO counterparties (id, name, type, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)`,
    ['c2', 'ИП Каримов', 'supplier', '+998909876543', 'karimov@mail.uz', 'Самарканд']);
  run(`INSERT INTO counterparties (id, name, type, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)`,
    ['c3', 'Магазин "Электро"', 'client', '+998931112233', 'electro@shop.uz', 'Ташкент']);
  run(`INSERT INTO counterparties (id, name, type, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)`,
    ['c4', 'ООО "ОфисПлюс"', 'client', '+998944556677', 'office@plus.uz', 'Бухара']);

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_seed_done', '1')");
}

export async function reloadDb() {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
  }
  return initDb();
}

export { dbPath, dataDir, backupDir } from './dbBackup.js';
export {
  backupDatabaseFile, listBackups, restoreDatabaseFromBackup, verifyDatabaseFile,
} from './dbBackup.js';

export default { initDb, reloadDb, queryAll, queryOne, run, transaction, getDb };
