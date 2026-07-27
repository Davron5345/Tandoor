/**
 * Final Postgres schema equivalent to post-migration SQLite (server/db.js).
 * Dates stay TEXT for format compatibility with the existing app.
 */

export const PG_SCHEMA_VERSION = 'pg_schema_v1';

export const PG_MIGRATION_SETTINGS_KEYS = [
  'branches_v1',
  'calculations_v1',
  'calculations_v2',
  'calculations_variants_v1',
  'calculations_kind_v1',
  'cash_articles_v1',
  'cash_articles_branch_v1',
  'cash_articles_surplus_v1',
  'cash_articles_client_debt_v1',
  'cash_articles_debt_return_v1',
  'counterparties_branch_v1',
  'counterparty_contracts_v1',
  'counterparty_inn_v1',
  'counterparty_firms_v1',
  'payment_bank_import_v1',
  'department_avg_cost_v1',
  'departments_v1',
  'doc_number_per_type_v1',
  'document_history_retain_v1',
  'document_item_cost_v1',
  'document_item_net_weight_v1',
  'document_item_sort_order_v1',
  'must_change_pwd_v1',
  'opening_balance_docs_v1',
  'performance_indexes_v1',
  'product_branches_v1',
  'product_branches_backfill_v1',
  'product_categories_v1',
  'product_images_v1',
  'product_kind_v1',
  'product_subcategories_v1',
  'product_variant_stock_v1',
  'product_variants_v1',
  'razdelka_v1',
  'return_supplier_source_doc_v1',
  'roles_branch_v1',
  'roles_flexible_v1',
  'sessions_meta_v1',
  'shop_order_document_v1',
  'shop_orders_v1',
  'shop_orders_dept_v1',
  'units_v1',
  'users_role_v2',
  'variant_department_stock_v1',
  'variant_department_stock_v2',
  'demo_seed_done',
  'departments_stock_v2',
];

const NOW = "TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')";

/** Ordered CREATE statements (FK-safe). */
export const PG_CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_system INTEGER DEFAULT 0,
  branch_id TEXT REFERENCES branches(id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (${NOW}),
  branch_id TEXT REFERENCES branches(id),
  must_change_password INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (${NOW}),
  ip TEXT,
  user_agent TEXT,
  device_label TEXT,
  device_id TEXT,
  last_seen_at TEXT,
  remember INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES product_categories(id),
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW})
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_units_name_lower ON units (lower(name));

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT DEFAULT 'шт',
  price DOUBLE PRECISION DEFAULT 0,
  stock DOUBLE PRECISION DEFAULT 0,
  created_at TEXT DEFAULT (${NOW}),
  updated_at TEXT DEFAULT (${NOW}),
  category_id TEXT REFERENCES product_categories(id),
  barcode TEXT,
  net_weight DOUBLE PRECISION,
  gross_weight DOUBLE PRECISION,
  has_variants INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  product_kind TEXT NOT NULL DEFAULT 'goods'
);

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW}),
  stock DOUBLE PRECISION DEFAULT 0,
  archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'gif')),
  size INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW}),
  variant_id TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  is_primary INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS counterparties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('supplier', 'client')),
  phone TEXT,
  email TEXT,
  telegram_chat_id TEXT,
  address TEXT,
  notes TEXT,
  inn TEXT,
  created_at TEXT DEFAULT (${NOW}),
  updated_at TEXT DEFAULT (${NOW}),
  branch_id TEXT REFERENCES branches(id),
  opening_balance DOUBLE PRECISION DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_suppliers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (${NOW}),
  branch_id TEXT REFERENCES branches(id),
  UNIQUE (product_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS counterparty_contracts (
  id TEXT PRIMARY KEY,
  counterparty_id TEXT NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL,
  number TEXT NOT NULL,
  date TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS counterparty_firms (
  id TEXT PRIMARY KEY,
  counterparty_id TEXT NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  inn TEXT,
  bank_account TEXT,
  mfo TEXT,
  contract_id TEXT REFERENCES counterparty_contracts(id),
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS product_branch_stock (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stock DOUBLE PRECISION DEFAULT 0,
  updated_at TEXT DEFAULT (${NOW}),
  UNIQUE (branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS product_department_stock (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  stock DOUBLE PRECISION DEFAULT 0,
  avg_cost DOUBLE PRECISION DEFAULT 0,
  updated_at TEXT DEFAULT (${NOW})
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pds_dept_product_variant
  ON product_department_stock (department_id, product_id, COALESCE(variant_id, ''));

CREATE TABLE IF NOT EXISTS product_branches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  visible INTEGER NOT NULL DEFAULT 1,
  price DOUBLE PRECISION,
  created_at TEXT DEFAULT (${NOW}),
  updated_at TEXT DEFAULT (${NOW}),
  UNIQUE (product_id, branch_id)
);

CREATE TABLE IF NOT EXISTS product_variant_branches (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  price DOUBLE PRECISION,
  created_at TEXT DEFAULT (${NOW}),
  updated_at TEXT DEFAULT (${NOW}),
  UNIQUE (variant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS calculations (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  source_product_id TEXT NOT NULL REFERENCES products(id),
  base_quantity DOUBLE PRECISION DEFAULT 1,
  active INTEGER DEFAULT 1,
  comment TEXT DEFAULT '',
  created_at TEXT DEFAULT (${NOW}),
  updated_at TEXT DEFAULT (${NOW}),
  kind TEXT NOT NULL DEFAULT 'razdelka'
);

CREATE TABLE IF NOT EXISTS calculation_items (
  id TEXT PRIMARY KEY,
  calculation_id TEXT NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_waste INTEGER DEFAULT 0,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS calculation_sources (
  id TEXT PRIMARY KEY,
  calculation_id TEXT NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  type TEXT NOT NULL,
  counterparty_id TEXT,
  contract_id TEXT,
  firm_id TEXT REFERENCES counterparty_firms(id),
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
  total_amount DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'draft',
  calculation_id TEXT,
  created_at TEXT DEFAULT (${NOW}),
  updated_at TEXT DEFAULT (${NOW}),
  UNIQUE (branch_id, type, number)
);

CREATE TABLE IF NOT EXISTS document_items (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  variant_id TEXT REFERENCES product_variants(id),
  item_role TEXT DEFAULT 'input',
  toza DOUBLE PRECISION DEFAULT 0,
  qiymali DOUBLE PRECISION DEFAULT 0,
  otkhod DOUBLE PRECISION DEFAULT 0,
  unit_cost DOUBLE PRECISION DEFAULT 0,
  cost_amount DOUBLE PRECISION DEFAULT 0,
  net_weight DOUBLE PRECISION,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS document_history (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  action TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  changed_by TEXT DEFAULT 'system',
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS opening_balance_lines (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL CHECK (line_type IN ('stock', 'debtor', 'creditor', 'cash', 'bank')),
  product_id TEXT REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id),
  department_id TEXT REFERENCES departments(id),
  counterparty_id TEXT REFERENCES counterparties(id),
  quantity DOUBLE PRECISION DEFAULT 0,
  unit_cost DOUBLE PRECISION DEFAULT 0,
  amount DOUBLE PRECISION DEFAULT 0,
  comment TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS branch_opening_balances (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  as_of_date TEXT,
  cash_balance DOUBLE PRECISION DEFAULT 0,
  notes TEXT DEFAULT '',
  updated_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS cash_articles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  branch_id TEXT REFERENCES branches(id),
  code TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('supplier_payment', 'customer_income', 'other_income', 'other_expense')),
  counterparty_id TEXT REFERENCES counterparties(id),
  document_id TEXT REFERENCES documents(id),
  amount DOUBLE PRECISION NOT NULL,
  date TEXT NOT NULL,
  comment TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (${NOW}),
  branch_id TEXT REFERENCES branches(id),
  article_id TEXT,
  external_ref TEXT,
  import_batch_id TEXT,
  contract_id TEXT,
  firm_id TEXT REFERENCES counterparty_firms(id)
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  number INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  delivery_type TEXT NOT NULL DEFAULT 'pickup' CHECK (delivery_type IN ('pickup', 'delivery')),
  address TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'processing', 'done', 'cancelled')),
  total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (${NOW}),
  updated_at TEXT DEFAULT (${NOW}),
  department_id TEXT REFERENCES departments(id),
  document_id TEXT REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS shop_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  unit TEXT,
  line_total DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_messages (
  id TEXT PRIMARY KEY,
  counterparty_id TEXT REFERENCES counterparties(id),
  document_id TEXT REFERENCES documents(id),
  chat_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'sent',
  error TEXT,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS visit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  action TEXT NOT NULL,
  success INTEGER DEFAULT 1,
  ip TEXT,
  user_agent TEXT,
  device_id TEXT,
  device_label TEXT,
  details TEXT,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS blocked_devices (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  user_id TEXT,
  ip TEXT,
  device_label TEXT,
  user_agent TEXT,
  blocked_by TEXT,
  reason TEXT,
  blocked_at TEXT DEFAULT (${NOW}),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS staff_locations (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  branch_id TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  recorded_at TEXT DEFAULT (${NOW}),
  source TEXT DEFAULT 'pwa'
);

CREATE TABLE IF NOT EXISTS staff_location_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  branch_id TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  recorded_at TEXT DEFAULT (${NOW}),
  source TEXT DEFAULT 'pwa'
);
`;

export const PG_CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_product_branches_branch ON product_branches (branch_id, visible);
CREATE INDEX IF NOT EXISTS idx_product_branches_product ON product_branches (product_id);
CREATE INDEX IF NOT EXISTS idx_documents_source_document ON documents (source_document_id);
CREATE INDEX IF NOT EXISTS idx_docs_branch_type_status_date ON documents (branch_id, type, status, date);
CREATE INDEX IF NOT EXISTS idx_docs_from_branch ON documents (from_branch_id, status, date);
CREATE INDEX IF NOT EXISTS idx_docs_to_branch ON documents (to_branch_id, status, date);
CREATE INDEX IF NOT EXISTS idx_docs_counterparty ON documents (counterparty_id);
CREATE INDEX IF NOT EXISTS idx_doc_items_doc ON document_items (document_id);
CREATE INDEX IF NOT EXISTS idx_doc_items_product ON document_items (product_id);
CREATE INDEX IF NOT EXISTS idx_document_history_document ON document_history (document_id);
CREATE INDEX IF NOT EXISTS idx_payments_branch_date ON payments (branch_id, date, type);
CREATE INDEX IF NOT EXISTS idx_payments_counterparty ON payments (counterparty_id);
CREATE INDEX IF NOT EXISTS idx_payments_document ON payments (document_id);
CREATE INDEX IF NOT EXISTS idx_payments_external_ref ON payments (branch_id, external_ref);
CREATE INDEX IF NOT EXISTS idx_cp_firms_counterparty ON counterparty_firms (counterparty_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_cp_firms_inn ON counterparty_firms (branch_id, inn);
CREATE INDEX IF NOT EXISTS idx_documents_firm ON documents (firm_id);
CREATE INDEX IF NOT EXISTS idx_payments_firm ON payments (firm_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions (device_id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_document ON shop_orders (document_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_visit_log_created ON visit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visit_log_action ON visit_log (action);
CREATE INDEX IF NOT EXISTS idx_visit_log_username ON visit_log (username);
CREATE INDEX IF NOT EXISTS idx_blocked_devices_device ON blocked_devices (device_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_branch ON push_subscriptions (branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_location_history_user ON staff_location_history (user_id, recorded_at DESC);
`;

/** Tables in dependency-friendly import order (parents before children). */
export const PG_TABLE_IMPORT_ORDER = [
  'branches',
  'settings',
  'roles',
  'role_permissions',
  'users',
  'sessions',
  'product_categories',
  'units',
  'products',
  'product_variants',
  'product_images',
  'counterparties',
  'product_suppliers',
  'counterparty_contracts',
  'counterparty_firms',
  'departments',
  'product_branch_stock',
  'product_department_stock',
  'product_branches',
  'product_variant_branches',
  'calculations',
  'calculation_items',
  'calculation_sources',
  'cash_articles',
  'documents',
  'document_items',
  'document_history',
  'opening_balance_lines',
  'branch_opening_balances',
  'payments',
  'shop_orders',
  'shop_order_items',
  'telegram_messages',
  'audit_log',
  'visit_log',
  'blocked_devices',
  'push_subscriptions',
  'staff_locations',
  'staff_location_history',
];
