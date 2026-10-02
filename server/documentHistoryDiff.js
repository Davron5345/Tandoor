import db from './db.js';

const { queryAll } = db;

const STATUS_LABELS = { draft: 'Черновик', confirmed: 'Проведён', cancelled: 'Отменён' };
const COVERAGE_LABELS = { partial: 'Частичная', full: 'Полная' };
const OB_LINE_LABELS = {
  stock: 'Остаток',
  debtor: 'Дебитор',
  creditor: 'Кредитор',
  cash: 'Касса',
  bank: 'Банк',
};
const ROLE_SUFFIX = { output: ' (выход)', sale: '' };
const HIDDEN_ITEM_ROLES = new Set(['consumption']);
const MONEY_EPS = 0.005;
const QTY_EPS = 0.0005;

const ITEM_FIELDS = [
  { key: 'quantity', label: 'Кол-во', kind: 'qty' },
  { key: 'net_weight', label: 'Нетто', kind: 'qty' },
  { key: 'book_qty', label: 'Учёт', kind: 'qty' },
  { key: 'price', label: 'Цена', kind: 'money' },
  { key: 'unit_cost', label: 'Себест.', kind: 'money' },
  { key: 'amount', label: 'Сумма', kind: 'money' },
];

const EXTRA_FIELDS = [
  { key: 'amount', label: 'Сумма', kind: 'money' },
  { key: 'capitalize', label: 'В себестоимость', kind: 'bool' },
];

const OB_LINE_FIELDS = [
  { key: 'quantity', label: 'Кол-во', kind: 'qty' },
  { key: 'unit_cost', label: 'Себест.', kind: 'money' },
  { key: 'amount', label: 'Сумма', kind: 'money' },
  { key: 'comment', label: 'Комментарий', kind: 'text' },
];

function parseSnapshot(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasDetails(snapshot) {
  return Boolean(snapshot?.document);
}

function namesById(table, ids, column = 'name') {
  const list = [...ids].filter(Boolean);
  if (!list.length) return new Map();
  const placeholders = list.map(() => '?').join(', ');
  const rows = queryAll(`SELECT id, ${column} AS label FROM ${table} WHERE id IN (${placeholders})`, list);
  return new Map(rows.map((r) => [r.id, r.label]));
}

function collectLookups(snapshots) {
  const ids = {
    counterparties: new Set(),
    contracts: new Set(),
    firms: new Set(),
    departments: new Set(),
    branches: new Set(),
    users: new Set(),
    articles: new Set(),
    variants: new Set(),
    products: new Set(),
    bankAccounts: new Set(),
  };
  for (const s of snapshots) {
    const d = s?.document;
    if (!d) continue;
    ids.counterparties.add(d.counterparty_id);
    ids.contracts.add(d.contract_id);
    ids.firms.add(d.firm_id);
    ids.departments.add(d.from_department_id);
    ids.departments.add(d.to_department_id);
    ids.departments.add(d.liable_department_id);
    ids.branches.add(d.from_branch_id);
    ids.branches.add(d.to_branch_id);
    ids.users.add(d.liable_user_id);
    ids.articles.add(d.article_id);
    for (const i of s.items || []) {
      ids.variants.add(i.variant_id);
      if (!i.product_name) ids.products.add(i.product_id);
    }
    for (const l of s.lines || []) {
      ids.products.add(l.product_id);
      ids.variants.add(l.variant_id);
      ids.departments.add(l.department_id);
      ids.counterparties.add(l.counterparty_id);
      ids.bankAccounts.add(l.bank_account_id);
    }
  }
  return {
    counterparties: namesById('counterparties', ids.counterparties),
    contracts: namesById('counterparty_contracts', ids.contracts, 'number'),
    firms: namesById('counterparty_firms', ids.firms),
    departments: namesById('departments', ids.departments),
    branches: namesById('branches', ids.branches),
    users: namesById('users', ids.users),
    articles: namesById('cash_articles', ids.articles),
    variants: namesById('product_variants', ids.variants),
    products: namesById('products', ids.products),
    bankAccounts: namesById('bank_accounts', ids.bankAccounts),
  };
}

function nameOf(map, id, fallback = null) {
  if (!id) return null;
  return map.get(id) || fallback || id;
}

function documentFieldValues(snapshot, lk) {
  const d = snapshot.document;
  const cpName = d.counterparty_id
    ? (snapshot.counterparty?.id === d.counterparty_id && snapshot.counterparty?.name)
      || nameOf(lk.counterparties, d.counterparty_id)
    : null;
  return [
    { key: 'number', label: 'Номер', kind: 'text', value: d.number || null },
    { key: 'date', label: 'Дата', kind: 'date', value: d.date || null },
    { key: 'status', label: 'Статус', kind: 'text', value: STATUS_LABELS[d.status] || d.status || null },
    { key: 'counterparty', label: 'Контрагент', kind: 'text', value: cpName },
    {
      key: 'contract',
      label: 'Договор',
      kind: 'text',
      value: d.contract_id ? nameOf(lk.contracts, d.contract_id) : (d.counterparty_id ? 'Основной договор' : null),
    },
    { key: 'firm', label: 'Фирма', kind: 'text', value: nameOf(lk.firms, d.firm_id) },
    { key: 'from_branch', label: 'Филиал-отправитель', kind: 'text', value: nameOf(lk.branches, d.from_branch_id) },
    { key: 'to_branch', label: 'Филиал-получатель', kind: 'text', value: nameOf(lk.branches, d.to_branch_id) },
    { key: 'from_department', label: 'Откуда (отдел)', kind: 'text', value: nameOf(lk.departments, d.from_department_id) },
    { key: 'to_department', label: 'Отдел', kind: 'text', value: nameOf(lk.departments, d.to_department_id) },
    {
      key: 'coverage',
      label: 'Покрытие',
      kind: 'text',
      value: d.type === 'inventory' ? (COVERAGE_LABELS[d.inventory_coverage] || d.inventory_coverage || null) : null,
    },
    { key: 'article', label: 'Статья', kind: 'text', value: nameOf(lk.articles, d.article_id) },
    { key: 'liable_user', label: 'Долг на сотрудника', kind: 'text', value: nameOf(lk.users, d.liable_user_id) },
    { key: 'liable_department', label: 'Долг на отдел', kind: 'text', value: nameOf(lk.departments, d.liable_department_id) },
    { key: 'comment', label: 'Комментарий', kind: 'text', value: d.comment || null },
    { key: 'total_amount', label: 'Итого', kind: 'money', value: Number(d.total_amount) || 0 },
  ];
}

function valuesEqual(kind, a, b) {
  if (kind === 'money' || kind === 'qty') {
    const na = a == null || a === '' ? 0 : Number(a);
    const nb = b == null || b === '' ? 0 : Number(b);
    return Math.abs(na - nb) < (kind === 'money' ? MONEY_EPS : QTY_EPS);
  }
  if (kind === 'bool') return Boolean(a) === Boolean(b);
  return (a ?? '') === (b ?? '');
}

function isEmptyValue(kind, v) {
  if (v == null || v === '') return true;
  if (kind === 'money' || kind === 'qty') return Math.abs(Number(v) || 0) < QTY_EPS;
  return false;
}

function diffFields(beforeFields, afterFields) {
  const beforeByKey = new Map((beforeFields || []).map((f) => [f.key, f]));
  const out = [];
  for (const f of afterFields) {
    const prev = beforeByKey.get(f.key);
    if (!prev) {
      if (!isEmptyValue(f.kind, f.value)) {
        out.push({ key: f.key, label: f.label, kind: f.kind, before: null, after: f.value });
      }
      continue;
    }
    if (!valuesEqual(f.kind, prev.value, f.value)) {
      out.push({ key: f.key, label: f.label, kind: f.kind, before: prev.value, after: f.value });
    }
  }
  return out;
}

function keyedRows(rows, keyOf) {
  const counts = new Map();
  return rows.map((row) => {
    const base = keyOf(row);
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    return { key: `${base}#${n}`, row };
  });
}

function rowValues(row, fields) {
  return fields
    .filter((f) => !isEmptyValue(f.kind, row[f.key]))
    .map((f) => ({ label: f.label, kind: f.kind, value: row[f.key] }));
}

function diffRows(beforeRows, afterRows, { keyOf, nameOf: rowName, fields }) {
  const before = keyedRows(beforeRows || [], keyOf);
  const after = keyedRows(afterRows || [], keyOf);
  const beforeMap = new Map(before.map((e) => [e.key, e.row]));
  const afterKeys = new Set(after.map((e) => e.key));
  const added = [];
  const changed = [];
  for (const { key, row } of after) {
    const prev = beforeMap.get(key);
    if (!prev) {
      added.push({ name: rowName(row), values: rowValues(row, fields) });
      continue;
    }
    const diffs = fields
      .filter((f) => !valuesEqual(f.kind, prev[f.key], row[f.key]))
      .map((f) => ({ label: f.label, kind: f.kind, before: prev[f.key] ?? null, after: row[f.key] ?? null }));
    if (diffs.length) changed.push({ name: rowName(row), fields: diffs });
  }
  const removed = before
    .filter((e) => !afterKeys.has(e.key))
    .map(({ row }) => ({ name: rowName(row), values: rowValues(row, fields) }));
  return { added, removed, changed };
}

function isEmptyRowDiff(d) {
  return !d || (!d.added.length && !d.removed.length && !d.changed.length);
}

function visibleItems(snapshot) {
  return (snapshot?.items || []).filter((i) => !HIDDEN_ITEM_ROLES.has(i.item_role));
}

function buildChanges(prev, curr, lk) {
  const itemOpts = {
    keyOf: (i) => `${i.product_id}|${i.variant_id || ''}|${i.item_role || 'input'}`,
    nameOf: (i) => {
      const base = i.product_name || nameOf(lk.products, i.product_id) || 'Товар';
      const variant = i.variant_name || nameOf(lk.variants, i.variant_id);
      return `${base}${variant ? ` — ${variant}` : ''}${ROLE_SUFFIX[i.item_role] || ''}`;
    },
    fields: ITEM_FIELDS,
  };
  const extraOpts = {
    keyOf: (e) => String(e.title || '').trim().toLowerCase(),
    nameOf: (e) => e.title || 'Доп. расход',
    fields: EXTRA_FIELDS,
  };
  const lineOpts = {
    keyOf: (l) => [
      l.line_type, l.product_id, l.variant_id, l.department_id, l.counterparty_id, l.bank_account_id,
    ].map((v) => v || '').join('|'),
    nameOf: (l) => {
      const parts = [OB_LINE_LABELS[l.line_type] || l.line_type];
      if (l.product_id) {
        const variant = nameOf(lk.variants, l.variant_id);
        parts.push(`${nameOf(lk.products, l.product_id)}${variant ? ` — ${variant}` : ''}`);
      }
      if (l.department_id) parts.push(nameOf(lk.departments, l.department_id));
      if (l.counterparty_id) parts.push(nameOf(lk.counterparties, l.counterparty_id));
      if (l.bank_account_id) parts.push(nameOf(lk.bankAccounts, l.bank_account_id));
      return parts.filter(Boolean).join(' · ');
    },
    fields: OB_LINE_FIELDS,
  };

  const items = diffRows(prev ? visibleItems(prev) : [], visibleItems(curr), itemOpts);
  const extraCosts = diffRows(prev?.extra_costs, curr.extra_costs, extraOpts);
  const lines = diffRows(prev?.lines, curr.lines, lineOpts);
  return {
    fields: diffFields(prev ? documentFieldValues(prev, lk) : null, documentFieldValues(curr, lk)),
    items: isEmptyRowDiff(items) ? null : items,
    extra_costs: isEmptyRowDiff(extraCosts) ? null : extraCosts,
    lines: isEmptyRowDiff(lines) ? null : lines,
  };
}

function actionOrder(action) {
  if (action === 'created') return 0;
  if (action === 'updated') return 1;
  if (action === 'confirmed') return 2;
  return 3;
}

/**
 * Записи истории (по возрастанию времени) → «было / стало» относительно предыдущего полного снимка.
 * Возвращает новые сверху.
 */
export function buildDocumentHistoryDiff(rows) {
  const entries = rows
    .map((row) => ({ ...row, parsed: parseSnapshot(row.snapshot) }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))
      || actionOrder(a.action) - actionOrder(b.action));

  const lk = collectLookups(entries.map((e) => e.parsed));
  let prev = null;
  const result = entries.map((e) => {
    const { parsed, snapshot: _snapshot, ...rest } = e; // eslint-disable-line no-unused-vars
    if (!hasDetails(parsed)) {
      return { ...rest, details_available: false, summary: null, changes: null };
    }
    const isInitial = prev === null;
    const changes = buildChanges(prev, parsed, lk);
    prev = parsed;
    return {
      ...rest,
      details_available: true,
      is_initial: isInitial,
      summary: {
        number: parsed.document.number,
        total_amount: Number(parsed.document.total_amount) || 0,
        items_count: visibleItems(parsed).length || (parsed.lines || []).length,
        status: parsed.document.status,
      },
      changes,
    };
  });
  return result.reverse();
}
