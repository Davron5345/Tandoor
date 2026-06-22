import db from './db.js';
import { DEFAULT_BRANCH_ID } from './branches.js';

const SYSTEM_ADMIN = 'admin';

const BUILTIN_ROLES = {
  admin: {
    label: 'Администратор',
    description: 'Полный доступ ко всем разделам',
    isSystem: true,
  },
  warehouse: {
    label: 'Завсклад',
    description: 'Приход, расход, перемещение товаров',
    isSystem: true,
  },
  cashier: {
    label: 'Кассир',
    description: 'Касса: приход и расход, операции за смену',
    isSystem: true,
  },
  accountant: {
    label: 'Бухгалтер',
    description: 'Касса, оплаты и отчёты',
    isSystem: true,
  },
};

export const ACTION_LABELS = {
  view: 'Смотреть',
  write: 'Редактировать',
  send: 'Отправлять',
  confirm: 'Провести',
  delete: 'Удалить',
  editPast: 'Прошлые даты',
};

export const ACTION_TOOLTIPS = {
  view: 'Открыть раздел и видеть данные',
  write: 'Создавать и изменять записи',
  send: 'Отправлять сообщения в Telegram',
  confirm: 'Проводить документы',
  delete: 'Удалять записи',
  editPast: 'Работать с датами, отличными от сегодняшней',
};

export const PERMISSION_ACTION_ORDER = ['view', 'write', 'send', 'confirm', 'delete', 'editPast'];

export const PERMISSION_CATEGORIES = [
  { id: 'main', label: 'Основное' },
  { id: 'catalog', label: 'Справочники' },
  { id: 'myshop', label: 'MyShop' },
  { id: 'documents', label: 'Складские документы' },
  { id: 'finance', label: 'Касса и финансы' },
  { id: 'admin', label: 'Администрирование' },
];

export const PERMISSION_GROUPS = [
  { id: 'dashboard', label: 'Главная', category: 'main', icon: '🏠', hint: 'Сводка на стартовой странице', actions: { view: 'dashboard.view' } },
  { id: 'products', label: 'Товары', category: 'catalog', icon: '📦', hint: 'Справочник номенклатуры', actions: { view: 'products.view', write: 'products.edit' } },
  { id: 'myshop', label: 'Витрина MyShop', category: 'myshop', icon: '🛍️', hint: 'Просмотр онлайн-магазина филиала', actions: { view: 'myshop.view', write: 'myshop.edit' } },
  { id: 'shop_orders', label: 'Заявки MyShop', category: 'myshop', icon: '🧾', hint: 'Заявки сотрудников на продукты для кухни: просмотр и смена статуса', actions: { view: 'shop_orders.view', write: 'shop_orders.edit' } },
  { id: 'calculations', label: 'Калькуляции', category: 'catalog', icon: '🧮', hint: 'Рецептуры и калькуляции', actions: { view: 'calculations.view', write: 'calculations.edit' } },
  { id: 'counterparties', label: 'Контрагенты', category: 'catalog', icon: '🤝', hint: 'Нужно кассиру: «Смотреть» — выбор поставщика при расходе «Закуп»', actions: { view: 'counterparties.view', write: 'counterparties.edit' } },
  { id: 'prihod', label: 'Приход', category: 'documents', icon: '📥', hint: 'Складской приход товаров', actions: { view: 'documents.prihod', write: 'documents.edit', confirm: 'documents.confirm', delete: 'documents.delete' } },
  { id: 'rashod', label: 'Расход', category: 'documents', icon: '📤', hint: 'Складской расход товаров и возврат поставщику', actions: { view: 'documents.rashod', write: 'documents.edit', confirm: 'documents.confirm', delete: 'documents.delete' } },
  { id: 'transfer', label: 'Перемещение', category: 'documents', icon: '🔄', hint: 'Перемещение между филиалами', actions: { view: 'documents.transfer', write: 'documents.edit', confirm: 'documents.confirm', delete: 'documents.delete' } },
  { id: 'razdelka', label: 'Разделка', category: 'documents', icon: '🔪', hint: 'Документы разделки', actions: { view: 'documents.razdelka', write: 'documents.edit', confirm: 'documents.confirm', delete: 'documents.delete' } },
  { id: 'dish_sale', label: 'Продажа блюд', category: 'documents', icon: '🍽️', hint: 'Продажа готовых блюд по рецепту: выручка в P&L, списание ингредиентов', actions: { view: 'documents.dish_sale', write: 'documents.edit', confirm: 'documents.confirm', delete: 'documents.delete' } },
  { id: 'documents', label: 'Все документы', category: 'documents', icon: '📋', hint: 'Общий список документов (просмотр)', actions: { view: 'documents.view' } },
  {
    id: 'cashier',
    label: 'Касса',
    category: 'finance',
    icon: '💵',
    hint: 'Смотреть — список операций за дату. Редактировать — провести приход/расход. Удалить — убрать ошибку за сегодня. Прошлые даты — только для бухгалтера/админа',
    actions: { view: 'cashier.view', write: 'cashier.edit', delete: 'cashier.delete', editPast: 'cashier.edit_past' },
  },
  { id: 'payments', label: 'Оплаты', category: 'finance', icon: '💰', hint: 'Старый раздел оплат (не путать с «Касса»)', actions: { view: 'payments.view', write: 'payments.edit', delete: 'payments.delete', editPast: 'payments.edit_past' } },
  { id: 'cash_articles', label: 'Статьи кассы', category: 'finance', icon: '📑', hint: 'Настройка статей прихода/расхода (бухгалтер)', actions: { view: 'cash_articles.view', write: 'cash_articles.edit' } },
  { id: 'reports', label: 'Отчёты', category: 'main', icon: '📊', hint: 'Остатки, дебиторы, кредиторы', actions: { view: 'reports.view' } },
  { id: 'opening_balance', label: 'Начальное сальдо', category: 'finance', icon: '⚖️', hint: 'Стартовые остатки товаров, долги контрагентов и касса', actions: { view: 'opening_balance.view', write: 'opening_balance.edit' } },
  { id: 'telegram', label: 'Telegram', category: 'admin', icon: '✈️', hint: 'Просмотр истории, настройка бота и ручная отправка', actions: { view: 'telegram.view', write: 'telegram.settings', send: 'telegram.send' } },
  { id: 'users', label: 'Сотрудники', category: 'admin', icon: '👤', actions: { view: 'users.view', write: 'users.edit' } },
  { id: 'branches', label: 'Филиалы', category: 'admin', icon: '🏢', actions: { view: 'branches.view', write: 'branches.edit' } },
];

export const PERMISSION_PRESETS = [
  {
    id: 'cashier_work',
    label: 'Кассир: рабочий набор',
    description: 'Касса (смотреть + проводить + удалять за сегодня), контрагенты, отчёты',
    groups: {
      dashboard: { view: true },
      counterparties: { view: true },
      documents: { view: true },
      cashier: { view: true, write: true, delete: true },
      reports: { view: true },
    },
  },
  {
    id: 'cashier_view',
    label: 'Кассир: только просмотр',
    description: 'Видеть операции за дату без проведения',
    groups: {
      dashboard: { view: true },
      cashier: { view: true },
      reports: { view: true },
    },
  },
  {
    id: 'accountant_finance',
    label: 'Бухгалтер: касса и финансы',
    description: 'Полная касса, прошлые даты, статьи кассы, оплаты',
    groups: {
      dashboard: { view: true },
      counterparties: { view: true },
      documents: { view: true },
      cashier: { view: true, write: true, delete: true, editPast: true },
      payments: { view: true, write: true, delete: true, editPast: true },
      cash_articles: { view: true, write: true },
      reports: { view: true },
    },
  },
  {
    id: 'myshop_orders',
    label: 'MyShop: заказы',
    description: 'Просмотр и обработка онлайн-заказов без доступа к товарам',
    groups: {
      shop_orders: { view: true, write: true },
    },
  },
];

const CASHIER_MINIMUM_PERMS = [
  'dashboard.view',
  'counterparties.view',
  'documents.view',
  'cashier.view',
  'cashier.edit',
  'cashier.delete',
  'reports.view',
];

const DEFAULT_ROLE_PERMISSIONS = {
  admin: ['*'],
  warehouse: [
    'dashboard.view', 'products.view', 'products.edit', 'myshop.view', 'myshop.edit',
    'shop_orders.view', 'shop_orders.edit',
    'calculations.view', 'calculations.edit', 'counterparties.view',
    'documents.prihod', 'documents.rashod', 'documents.transfer', 'documents.razdelka', 'documents.dish_sale',
    'documents.view', 'documents.edit', 'documents.confirm', 'documents.delete',
    'reports.view',
  ],
  cashier: CASHIER_MINIMUM_PERMS,
  accountant: [
    'dashboard.view', 'counterparties.view', 'documents.view',
    'documents.dish_sale', 'documents.edit', 'documents.confirm',
    'cashier.view', 'cashier.edit', 'cashier.delete', 'cashier.edit_past',
    'payments.view', 'payments.edit', 'payments.delete', 'payments.edit_past',
    'cash_articles.view', 'cash_articles.edit',
    'reports.view',
    'opening_balance.view', 'opening_balance.edit',
  ],
};

let rolesCache = null;
let permissionsCache = null;

function mapRoleRow(row) {
  return {
    id: row.id,
    label: row.label,
    description: row.description || '',
    isSystem: !!row.is_system,
    branchId: row.branch_id || null,
  };
}

function seedDefaultRoles(dbInstance) {
  for (const [id, data] of Object.entries(BUILTIN_ROLES)) {
    const branchId = id === SYSTEM_ADMIN ? null : DEFAULT_BRANCH_ID;
    dbInstance.run(
      'INSERT INTO roles (id, label, description, is_system, branch_id) VALUES (?, ?, ?, ?, ?)',
      [id, data.label, data.description, id === SYSTEM_ADMIN ? 1 : 0, branchId],
    );
  }
}

export function getRoleBranchId(roleId) {
  return getRoles()[roleId]?.branchId ?? null;
}

export function assertRoleMatchesBranch(roleId, branchId) {
  if (roleId === SYSTEM_ADMIN) return;
  const roleBranch = getRoleBranchId(roleId);
  if (roleBranch && branchId && roleBranch !== branchId) {
    throw new Error('Роль принадлежит другому филиалу');
  }
}

export function assertRoleBranchAccess(roleId, branchId, { allBranches = false } = {}) {
  if (roleId === SYSTEM_ADMIN) return;
  if (allBranches) return;
  const roleBranch = getRoleBranchId(roleId);
  if (roleBranch && roleBranch !== branchId) {
    throw new Error('Роль принадлежит другому филиалу');
  }
}

export function getRolesForBranch(branchId, { allBranches = false, includeAdmin = false } = {}) {
  const roles = getRoles();
  const filtered = {};
  for (const [id, meta] of Object.entries(roles)) {
    if (id === SYSTEM_ADMIN) {
      if (includeAdmin) filtered[id] = meta;
      continue;
    }
    if (allBranches || meta.branchId === branchId) {
      filtered[id] = meta;
    }
  }
  return filtered;
}

const BRANCH_ROLE_TEMPLATE_IDS = ['cashier', 'accountant', 'warehouse'];

export function seedBranchRoles(dbInstance, branchId) {
  if (!branchId || branchId === DEFAULT_BRANCH_ID) return;

  for (const templateId of BRANCH_ROLE_TEMPLATE_IDS) {
    const newId = `${templateId}_${branchId}`.replace(/[^a-z0-9_]/g, '_').slice(0, 32);
    if (dbInstance.queryOne('SELECT id FROM roles WHERE id = ?', [newId])) continue;

    const templateRow = dbInstance.queryOne('SELECT label, description FROM roles WHERE id = ?', [templateId]);
    const template = templateRow || BUILTIN_ROLES[templateId];
    if (!template) continue;

    dbInstance.run(
      'INSERT INTO roles (id, label, description, is_system, branch_id) VALUES (?, ?, ?, 0, ?)',
      [newId, template.label, template.description || '', branchId],
    );

    const perms = getPermissionsForRole(templateId);
    for (const perm of perms) {
      dbInstance.run('INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)', [newId, perm]);
    }
  }

  initRoles(dbInstance);
  permissionsCache = loadRolePermissionsFromDb(dbInstance);
}

export function initRoles(dbInstance) {
  const rows = dbInstance.queryAll(
    'SELECT id, label, description, is_system, branch_id FROM roles ORDER BY is_system DESC, label',
  );
  if (rows.length === 0) {
    seedDefaultRoles(dbInstance);
    return initRoles(dbInstance);
  }

  rolesCache = {};
  for (const row of rows) {
    const role = mapRoleRow(row);
    rolesCache[row.id] = {
      label: role.label,
      description: role.description,
      isSystem: role.isSystem,
      branchId: role.branchId,
    };
  }
}

export function getRoles() {
  return rolesCache || { ...BUILTIN_ROLES };
}

export function getRole(id) {
  const meta = getRoles()[id];
  if (!meta) return null;
  return { id, ...meta };
}

export function getRolesWithStats(dbInstance, { branchId = null, allBranches = false } = {}) {
  const userCounts = dbInstance.queryAll(
    'SELECT role, branch_id, COUNT(*) as c FROM users GROUP BY role, branch_id',
  );
  const branchNames = Object.fromEntries(
    dbInstance.queryAll('SELECT id, name FROM branches').map((b) => [b.id, b.name]),
  );

  let entries = Object.entries(getRoles());
  if (allBranches) {
    // headquarters: all roles
  } else if (branchId) {
    entries = entries.filter(([id, meta]) => id !== SYSTEM_ADMIN && meta.branchId === branchId);
  }

  return entries.map(([id, meta]) => {
    let userCount = 0;
    if (allBranches) {
      userCount = userCounts.filter((u) => u.role === id).reduce((sum, u) => sum + u.c, 0);
    } else {
      userCount = userCounts.find((u) => u.role === id && u.branch_id === branchId)?.c || 0;
    }
    return {
      id,
      label: meta.label,
      description: meta.description,
      isSystem: meta.isSystem,
      branchId: meta.branchId,
      branchName: meta.branchId ? (branchNames[meta.branchId] || meta.branchId) : null,
      userCount,
      protected: id === SYSTEM_ADMIN,
    };
  });
}

export function roleExists(role) {
  return !!getRoles()[role];
}

export function normalizeRoleId(id) {
  return (id || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugFromLabel(label) {
  const lower = (label || '').trim().toLowerCase();
  let result = '';
  for (const char of lower) {
    if (TRANSLIT[char] !== undefined) result += TRANSLIT[char];
    else if (/[a-z0-9]/.test(char)) result += char;
    else if (/\s|-/.test(char)) result += '_';
  }
  return normalizeRoleId(result.replace(/_+/g, '_'));
}

export function createRole(dbInstance, data) {
  let id = normalizeRoleId(data.id) || slugFromLabel(data.label);
  if (!id) throw new Error('Укажите название или код роли');
  if (id === SYSTEM_ADMIN) throw new Error('Нельзя создать роль admin');

  const branchId = (data.branch_id || '').trim();
  if (!branchId) throw new Error('Укажите филиал для роли');

  if (roleExists(id)) {
    const suffixed = `${id}_${branchId}`.replace(/[^a-z0-9_]/g, '_').slice(0, 32);
    if (!roleExists(suffixed)) id = suffixed;
    else throw new Error('Роль с таким кодом уже существует');
  }

  const label = (data.label || '').trim();
  if (!label) throw new Error('Укажите название роли');

  dbInstance.run(
    'INSERT INTO roles (id, label, description, is_system, branch_id) VALUES (?, ?, ?, 0, ?)',
    [id, label, (data.description || '').trim(), branchId],
  );
  initRoles(dbInstance);

  const copyFrom = data.copyFrom && data.copyFrom !== SYSTEM_ADMIN ? data.copyFrom : null;
  if (copyFrom && roleExists(copyFrom)) {
    const perms = getPermissionsForRole(copyFrom);
    if (perms.length) savePermissionsForRole(dbInstance, id, perms);
  }

  return getRole(id);
}

export function updateRole(db, id, data) {
  if (!roleExists(id)) throw new Error('Роль не найдена');
  if (id === SYSTEM_ADMIN) throw new Error('Нельзя изменить роль администратора');

  const label = (data.label || '').trim();
  if (!label) throw new Error('Укажите название роли');

  db.run(
    'UPDATE roles SET label = ?, description = ? WHERE id = ?',
    [label, (data.description || '').trim(), id],
  );
  initRoles(db);
  return getRole(id);
}

export function deleteRole(db, id) {
  if (id === SYSTEM_ADMIN) throw new Error('Нельзя удалить роль администратора');

  const row = db.queryOne('SELECT * FROM roles WHERE id = ?', [id]);
  if (!row) throw new Error('Роль не найдена');

  const usersCount = db.queryOne('SELECT COUNT(*) as c FROM users WHERE role = ?', [id]).c;
  if (usersCount > 0) throw new Error('На этой роли есть сотрудники — сначала переназначьте их');

  db.transaction(() => {
    db.run('DELETE FROM role_permissions WHERE role = ?', [id]);
    db.run('DELETE FROM roles WHERE id = ?', [id]);
  });

  initRoles(db);
  permissionsCache = loadRolePermissionsFromDb(db);
}

export function getAllPermissionKeys() {
  const keys = new Set();
  for (const group of PERMISSION_GROUPS) {
    for (const key of Object.values(group.actions)) keys.add(key);
  }
  return [...keys];
}

export function loadRolePermissionsFromDb(db) {
  const rows = db.queryAll('SELECT role, permission FROM role_permissions');
  if (rows.length === 0) return null;

  const map = {};
  for (const row of rows) {
    if (!map[row.role]) map[row.role] = [];
    map[row.role].push(row.permission);
  }
  return map;
}

export function seedRolePermissions(db) {
  const existing = db.queryOne('SELECT COUNT(*) as c FROM role_permissions').c;
  if (existing > 0) return;

  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const perm of perms) {
      if (perm === '*') continue;
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, perm]);
    }
  }
}

export function initPermissions(db) {
  initRoles(db);
  seedRolePermissions(db);
  migrateRazdelkaPermissions(db);
  migrateDishSalePermissions(db);
  migrateCalculationsPermissions(db);
  migrateReportsPermissions(db);
  migratePaymentsAccess(db);
  migrateCashArticlesPermissions(db);
  migrateCashierPermissions(db);
  migrateCashierCounterpartiesAccess(db);
  migrateCashierBundleSync(db);
  migrateTelegramSendPermission(db);
  migrateMyShopPermissions(db);
  migrateOpeningBalancePermissions(db);
  permissionsCache = loadRolePermissionsFromDb(db) || { ...DEFAULT_ROLE_PERMISSIONS };
}

/** Связанные права: при сохранении дополняем обязательные зависимости. */
export function normalizePermissionBundle(permissions) {
  const set = new Set(permissions.filter(Boolean));

  if (set.has('cashier.edit') || set.has('cashier.delete') || set.has('cashier.edit_past')) {
    set.add('cashier.view');
  }
  if (set.has('cashier.view') || set.has('cashier.edit') || set.has('cashier.delete')) {
    set.add('counterparties.view');
  }
  if (set.has('payments.edit') || set.has('payments.delete') || set.has('payments.edit_past')) {
    set.add('payments.view');
  }
  if (set.has('cashier.edit_past')) {
    set.add('cashier.edit');
  }
  if (set.has('payments.edit_past')) {
    set.add('payments.edit');
  }
  if (set.has('telegram.settings') || set.has('telegram.send')) {
    set.add('telegram.view');
  }
  if (set.has('myshop.edit')) {
    set.add('myshop.view');
  }
  if (set.has('shop_orders.edit')) {
    set.add('shop_orders.view');
  }

  return [...set];
}

function migrateOpeningBalancePermissions(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'opening_balance_perm_v1'");
  if (done) return;

  for (const perm of ['opening_balance.view', 'opening_balance.edit']) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      ['accountant', perm],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['accountant', perm]);
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('opening_balance_perm_v1', '1')");
}

function migrateMyShopPermissions(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'myshop_perm_v1'");
  if (done) return;

  const roleRows = db.queryAll('SELECT DISTINCT role FROM role_permissions');
  for (const { role } of roleRows) {
    if (role === SYSTEM_ADMIN) continue;

    const perms = db.queryAll(
      'SELECT permission FROM role_permissions WHERE role = ?',
      [role],
    ).map((r) => r.permission);

    const toAdd = [];
    if (perms.includes('products.view')) {
      toAdd.push('myshop.view', 'shop_orders.view');
    }
    if (perms.includes('products.edit')) {
      toAdd.push('myshop.edit', 'shop_orders.edit');
    }

    for (const perm of normalizePermissionBundle(toAdd)) {
      if (!perms.includes(perm)) {
        db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, perm]);
      }
    }
  }

  for (const perm of ['myshop.view', 'myshop.edit', 'shop_orders.view', 'shop_orders.edit']) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      ['warehouse', perm],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['warehouse', perm]);
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('myshop_perm_v1', '1')");
}

function migrateTelegramSendPermission(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'telegram_send_v1'");
  if (done) return;

  const roleRows = db.queryAll('SELECT DISTINCT role FROM role_permissions');
  for (const { role } of roleRows) {
    if (role === SYSTEM_ADMIN) continue;
    const hasSettings = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      [role, 'telegram.settings'],
    );
    if (hasSettings) {
      const hasSend = db.queryOne(
        'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
        [role, 'telegram.send'],
      );
      if (!hasSend) {
        db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, 'telegram.send']);
      }
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_send_v1', '1')");
}

function migrateCashierBundleSync(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'cashier_bundle_v2'");
  if (done) return;

  const roleRows = db.queryAll('SELECT DISTINCT role FROM role_permissions');
  for (const { role } of roleRows) {
    if (role === SYSTEM_ADMIN) continue;
    const perms = db.queryAll(
      'SELECT permission FROM role_permissions WHERE role = ?',
      [role],
    ).map((r) => r.permission);

    const hasCashierWork = perms.some((p) => [
      'cashier.view', 'cashier.edit', 'cashier.delete', 'payments.edit',
    ].includes(p));

    let next = normalizePermissionBundle(perms);
    if (role === 'cashier') {
      next = normalizePermissionBundle([...next, ...CASHIER_MINIMUM_PERMS]);
    } else if (hasCashierWork && perms.includes('cashier.edit') && !perms.includes('cashier.delete')) {
      next = normalizePermissionBundle([...next, 'cashier.delete']);
    }

    const normalized = new Set(next);
    for (const perm of normalized) {
      if (!perms.includes(perm)) {
        db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, perm]);
      }
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('cashier_bundle_v2', '1')");
}

function migrateCashierPermissions(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'cashier_perm_v1'");
  if (done) return;

  const roleRows = db.queryAll('SELECT DISTINCT role FROM role_permissions');
  const roles = roleRows.map((r) => r.role);

  const mappings = [
    { from: 'payments.edit', to: ['cashier.view', 'cashier.edit'] },
    { from: 'payments.delete', to: ['cashier.delete'] },
    { from: 'payments.edit_past', to: ['cashier.edit_past'] },
  ];

  for (const role of roles) {
    if (role === SYSTEM_ADMIN) continue;
    for (const { from, to } of mappings) {
      const hasFrom = db.queryOne(
        'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
        [role, from],
      );
      if (!hasFrom) continue;
      for (const perm of to) {
        const exists = db.queryOne(
          'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
          [role, perm],
        );
        if (!exists) {
          db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, perm]);
        }
      }
    }
  }

  for (const perm of DEFAULT_ROLE_PERMISSIONS.cashier) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      ['cashier', perm],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['cashier', perm]);
    }
  }

  for (const perm of ['cashier.view', 'cashier.edit', 'cashier.delete', 'cashier.edit_past']) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      ['accountant', perm],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['accountant', perm]);
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('cashier_perm_v1', '1')");
}

function migrateCashierCounterpartiesAccess(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'cashier_cp_view_v1'");
  if (done) return;

  const roleRows = db.queryAll('SELECT DISTINCT role FROM role_permissions');
  for (const { role } of roleRows) {
    if (role === SYSTEM_ADMIN) continue;
    const hasCashierAccess = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission IN (?, ?, ?, ?) LIMIT 1',
      [role, 'cashier.view', 'cashier.edit', 'payments.view', 'payments.edit'],
    );
    if (!hasCashierAccess) continue;
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      [role, 'counterparties.view'],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, 'counterparties.view']);
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('cashier_cp_view_v1', '1')");
}

function migrateCashArticlesPermissions(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'cash_articles_perm_v1'");
  if (done) return;

  for (const perm of ['cash_articles.view', 'cash_articles.edit']) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      ['accountant', perm],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['accountant', perm]);
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('cash_articles_perm_v1', '1')");
}

function migratePaymentsAccess(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'payments_access_v1'");
  if (done) return;

  const accountant = db.queryOne("SELECT id FROM roles WHERE id = 'accountant'");
  if (!accountant) {
    db.run(
      'INSERT INTO roles (id, label, description, is_system) VALUES (?, ?, ?, ?)',
      ['accountant', 'Бухгалтер', 'Касса, оплаты и отчёты', 1],
    );
  }

  for (const perm of DEFAULT_ROLE_PERMISSIONS.accountant) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      ['accountant', perm],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['accountant', perm]);
    }
  }

  for (const perm of ['payments.delete']) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      ['cashier', perm],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['cashier', perm]);
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('payments_access_v1', '1')");
}

function migrateReportsPermissions(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'reports_perm_v1'");
  if (done) return;

  for (const role of ['warehouse', 'cashier']) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      [role, 'reports.view'],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, 'reports.view']);
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('reports_perm_v1', '1')");
}

function migrateDishSalePermissions(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'dish_sale_perm_v1'");
  if (done) return;

  for (const role of ['warehouse', 'accountant', 'admin']) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      [role, 'documents.dish_sale'],
    );
    if (!exists) {
      db.run("INSERT INTO role_permissions (role, permission) VALUES (?, 'documents.dish_sale')", [role]);
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('dish_sale_perm_v1', '1')");
}

function migrateRazdelkaPermissions(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'razdelka_perm_v1'");
  if (done) return;

  const exists = db.queryOne(
    "SELECT 1 as ok FROM role_permissions WHERE role = 'warehouse' AND permission = 'documents.razdelka' LIMIT 1",
  );
  if (!exists) {
    db.run("INSERT INTO role_permissions (role, permission) VALUES ('warehouse', 'documents.razdelka')");
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('razdelka_perm_v1', '1')");
}

function migrateCalculationsPermissions(db) {
  const done = db.queryOne("SELECT value FROM settings WHERE key = 'calculations_perm_v1'");
  if (done) return;

  for (const perm of ['calculations.view', 'calculations.edit']) {
    const exists = db.queryOne(
      'SELECT 1 as ok FROM role_permissions WHERE role = ? AND permission = ? LIMIT 1',
      ['warehouse', perm],
    );
    if (!exists) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['warehouse', perm]);
    }
  }

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('calculations_perm_v1', '1')");
}

export function getPermissionsForRole(role) {
  if (role === SYSTEM_ADMIN) return ['*'];
  const perms = permissionsCache?.[role] || DEFAULT_ROLE_PERMISSIONS[role] || [];
  return [...new Set(perms)];
}

export function savePermissionsForRole(db, role, permissions) {
  if (role === SYSTEM_ADMIN) throw new Error('Права администратора нельзя изменить');
  if (!roleExists(role)) throw new Error('Роль не найдена');

  const allowed = new Set(getAllPermissionKeys());
  const filtered = normalizePermissionBundle(
    [...new Set(permissions.filter((p) => allowed.has(p)))],
  );

  db.transaction(() => {
    db.run('DELETE FROM role_permissions WHERE role = ?', [role]);
    for (const perm of filtered) {
      db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, perm]);
    }
  });

  permissionsCache = loadRolePermissionsFromDb(db);
  return getPermissionsForRole(role);
}

export function getRolePermissionsMatrix(role) {
  const perms = new Set(getPermissionsForRole(role));
  const matrix = {};

  for (const group of PERMISSION_GROUPS) {
    matrix[group.id] = {};
    for (const [action, key] of Object.entries(group.actions)) {
      matrix[group.id][action] = role === SYSTEM_ADMIN || perms.has('*') || perms.has(key);
    }
  }
  return matrix;
}

export function matrixToPermissions(matrix) {
  const perms = new Set();
  for (const group of PERMISSION_GROUPS) {
    const row = matrix[group.id] || {};
    for (const [action, key] of Object.entries(group.actions)) {
      if (row[action]) perms.add(key);
    }
  }
  return [...perms];
}

export function hasPermission(role, permission) {
  const perms = getPermissionsForRole(role);
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

export function hasAnyPermission(role, permissions) {
  return permissions.some((p) => hasPermission(role, p));
}

export function getUserPayload(user) {
  const branch = user.branch_id
    ? db.queryOne('SELECT id, name FROM branches WHERE id = ?', [user.branch_id])
    : null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    roleLabel: getRoles()[user.role]?.label || user.role,
    branch_id: user.branch_id || null,
    branch_name: branch?.name || null,
    permissions: getPermissionsForRole(user.role),
    must_change_password: !!user.must_change_password,
  };
}

export function canAccessDocumentType(role, type) {
  if (type === 'prihod') return hasPermission(role, 'documents.prihod');
  if (type === 'rashod' || type === 'return_supplier' || type === 'return_customer') {
    return hasPermission(role, 'documents.rashod');
  }
  if (type === 'peremeshchenie') return hasPermission(role, 'documents.transfer');
  if (type === 'razdelka') return hasPermission(role, 'documents.razdelka');
  if (type === 'dish_sale') return hasPermission(role, 'documents.dish_sale');
  return hasPermission(role, 'documents.view');
}

export function getPermissionsConfig() {
  return {
    roles: getRoles(),
    actionLabels: ACTION_LABELS,
    actionTooltips: ACTION_TOOLTIPS,
    actionOrder: PERMISSION_ACTION_ORDER,
    categories: PERMISSION_CATEGORIES,
    presets: PERMISSION_PRESETS,
    groups: PERMISSION_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      category: g.category,
      icon: g.icon,
      hint: g.hint || '',
      actions: Object.keys(g.actions),
    })),
  };
}
