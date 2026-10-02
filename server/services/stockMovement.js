import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { getDefaultDepartmentId } from '../departments.js';

const { queryAll } = db;

const EPS = 1e-6;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Виды движения: направление и подпись столбца отчёта. */
export const MOVEMENT_KINDS = [
  { key: 'opening_balance', dir: 'in', label: 'Нач. сальдо' },
  { key: 'prihod', dir: 'in', label: 'От поставщика' },
  { key: 'transfer_in', dir: 'in', label: 'Перемещение (из отделов)' },
  { key: 'razdelka_out', dir: 'in', label: 'Разделка (выход)' },
  { key: 'return_customer', dir: 'in', label: 'Возврат от клиента' },
  { key: 'inventory_plus', dir: 'in', label: 'Излишек (инвент.)' },
  { key: 'rashod', dir: 'out', label: 'Продажа / расход' },
  { key: 'dish_sale', dir: 'out', label: 'На блюда' },
  { key: 'razdelka_in', dir: 'out', label: 'Разделка (вход)' },
  { key: 'transfer_out', dir: 'out', label: 'Перемещение (в отделы)' },
  { key: 'return_supplier', dir: 'out', label: 'Возврат поставщику' },
  { key: 'inventory_minus', dir: 'out', label: 'Недостача (инвент.)' },
];

const KIND_DIR = Object.fromEntries(MOVEMENT_KINDS.map((k) => [k.key, k.dir]));
const KIND_LABEL = Object.fromEntries(MOVEMENT_KINDS.map((k) => [k.key, k.label]));

const DOC_TYPES = [
  'prihod', 'rashod', 'return_supplier', 'return_customer',
  'peremeshchenie', 'razdelka', 'dish_sale', 'inventory',
];

/** Складское кол-во строки — как в проводке (`itemStockQty` в documents.js). */
function stockQty(item) {
  const qty = Math.abs(Number(item.quantity) || 0);
  const net = Number(item.net_weight) || 0;
  return net > 0 ? net * qty : qty;
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function assertDate(value, label) {
  if (value && !DATE_RE.test(value)) throw new Error(`Некорректная дата «${label}»`);
}

function branchDepartments(branchId) {
  return queryAll('SELECT id, name FROM departments WHERE branch_id = ? ORDER BY name', [branchId]);
}

/**
 * Все движения остатков по отделам филиала до `dateTo` включительно.
 * Логика повторяет `updateStock` / `applyInventoryStock` / проводку НС.
 */
function collectEvents(branchId, { dateTo = null, departmentIds, productId = null, variantId } = {}) {
  const deptSet = new Set(departmentIds);
  if (!deptSet.size) return [];
  const deptList = [...deptSet];
  const deptPh = deptList.map(() => '?').join(', ');
  const typePh = DOC_TYPES.map(() => '?').join(', ');

  const params = [...DOC_TYPES, ...deptList, ...deptList, branchId, branchId];
  let where = `d.status = 'confirmed' AND d.type IN (${typePh})
    AND (d.from_department_id IN (${deptPh}) OR d.to_department_id IN (${deptPh})`;
  // Перемещение без одного из отделов идёт через отдел по умолчанию филиала
  where += ` OR (d.type = 'peremeshchenie' AND (d.branch_id = ? OR d.from_branch_id = ?)
    AND (d.from_department_id IS NULL OR d.to_department_id IS NULL)
    AND (d.from_department_id IS NOT NULL OR d.to_department_id IS NOT NULL)))`;
  if (dateTo) {
    where += ' AND d.date <= ?';
    params.push(dateTo);
  }
  if (productId) {
    where += ' AND di.product_id = ?';
    params.push(productId);
  }

  const rows = queryAll(`
    SELECT d.id AS doc_id, d.type, d.number, d.date, d.created_at, d.branch_id,
           d.from_branch_id, d.to_branch_id, d.from_department_id, d.to_department_id,
           d.source_document_id,
           di.product_id, di.variant_id, di.quantity, di.net_weight, di.book_qty, di.item_role
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    WHERE ${where}
  `, params);

  const defaultDeptCache = new Map();
  const defaultDept = (bid) => {
    const key = bid || DEFAULT_BRANCH_ID;
    if (!defaultDeptCache.has(key)) defaultDeptCache.set(key, getDefaultDepartmentId(key));
    return defaultDeptCache.get(key);
  };

  const events = [];
  const push = (row, departmentId, kind, qty) => {
    if (!departmentId || !deptSet.has(departmentId)) return;
    if (Math.abs(qty) <= EPS) return;
    events.push({
      date: row.date,
      created_at: row.created_at,
      doc_id: row.doc_id,
      doc_type: row.type,
      doc_number: row.number,
      is_remainder: Boolean(row.source_document_id),
      department_id: departmentId,
      product_id: row.product_id,
      variant_id: row.variant_id || null,
      kind,
      qty: KIND_DIR[kind] === 'in' ? Math.abs(qty) : -Math.abs(qty),
    });
  };

  for (const row of rows) {
    const role = row.item_role || 'input';
    switch (row.type) {
      case 'prihod':
        push(row, row.to_department_id, 'prihod', stockQty(row));
        break;
      case 'return_customer':
        push(row, row.to_department_id, 'return_customer', Math.abs(Number(row.quantity) || 0));
        break;
      case 'rashod':
        push(row, row.from_department_id, 'rashod', Math.abs(Number(row.quantity) || 0));
        break;
      case 'return_supplier':
        push(row, row.from_department_id, 'return_supplier', stockQty(row));
        break;
      case 'razdelka':
        if (role === 'input') push(row, row.from_department_id, 'razdelka_in', Math.abs(Number(row.quantity) || 0));
        if (role === 'output') push(row, row.to_department_id, 'razdelka_out', Math.abs(Number(row.quantity) || 0));
        break;
      case 'dish_sale':
        if (role === 'consumption') push(row, row.from_department_id, 'dish_sale', Math.abs(Number(row.quantity) || 0));
        break;
      case 'peremeshchenie': {
        let source = row.from_department_id;
        let target = row.to_department_id;
        if (!source && !target) break;
        const srcBranch = row.from_branch_id || row.branch_id;
        if (!source) source = defaultDept(srcBranch);
        if (!target) target = defaultDept(srcBranch);
        const qty = stockQty(row);
        push(row, source, 'transfer_out', qty);
        push(row, target, 'transfer_in', qty);
        break;
      }
      case 'inventory': {
        const diff = stockQty(row) - (Number(row.book_qty) || 0);
        if (diff > EPS) push(row, row.to_department_id, 'inventory_plus', diff);
        else if (diff < -EPS) push(row, row.to_department_id, 'inventory_minus', -diff);
        break;
      }
      default:
        break;
    }
  }

  const obParams = [...deptList];
  let obWhere = `d.type = 'opening_balance' AND d.status = 'confirmed' AND obl.line_type = 'stock'
    AND obl.department_id IN (${deptPh})`;
  if (dateTo) {
    obWhere += ' AND d.date <= ?';
    obParams.push(dateTo);
  }
  if (productId) {
    obWhere += ' AND obl.product_id = ?';
    obParams.push(productId);
  }
  const obRows = queryAll(`
    SELECT d.id AS doc_id, d.type, d.number, d.date, d.created_at,
           obl.department_id, obl.product_id, obl.variant_id, obl.quantity
    FROM opening_balance_lines obl
    JOIN documents d ON d.id = obl.document_id
    WHERE ${obWhere}
  `, obParams);
  for (const row of obRows) {
    push(row, row.department_id, 'opening_balance', Math.abs(Number(row.quantity) || 0));
  }

  const filtered = variantId === undefined
    ? events
    : events.filter((e) => (e.variant_id || '') === (variantId || ''));
  return filtered.sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

function resolveDepartmentIds(branchId, departmentId) {
  const departments = branchDepartments(branchId);
  if (departmentId) {
    const dept = departments.find((d) => d.id === departmentId);
    if (!dept) throw new Error('Отдел не найден в этом филиале');
    return { departments, departmentIds: [dept.id] };
  }
  return { departments, departmentIds: departments.map((d) => d.id) };
}

function emptyKinds() {
  return Object.fromEntries(MOVEMENT_KINDS.map((k) => [k.key, 0]));
}

/**
 * Движение товаров по отделам за период в количестве (складские единицы).
 * Строка = товар + вариант + отдел.
 */
export function getStockMovementReport(branchId = DEFAULT_BRANCH_ID, filters = {}) {
  const dateFrom = filters.date_from || null;
  const dateTo = filters.date_to || null;
  assertDate(dateFrom, 'С');
  assertDate(dateTo, 'По');
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('Дата «С» позже даты «По»');

  const { departments, departmentIds } = resolveDepartmentIds(branchId, filters.department_id || null);
  const events = collectEvents(branchId, { dateTo, departmentIds });

  const rowsByKey = new Map();
  const rowFor = (e) => {
    const key = `${e.product_id}|${e.variant_id || ''}|${e.department_id}`;
    let row = rowsByKey.get(key);
    if (!row) {
      row = {
        product_id: e.product_id,
        variant_id: e.variant_id,
        department_id: e.department_id,
        opening: 0,
        movements: emptyKinds(),
      };
      rowsByKey.set(key, row);
    }
    return row;
  };

  for (const e of events) {
    const row = rowFor(e);
    if (dateFrom && e.date < dateFrom) {
      row.opening += e.qty;
    } else {
      row.movements[e.kind] += Math.abs(e.qty);
    }
  }

  const productIds = [...new Set([...rowsByKey.values()].map((r) => r.product_id))];
  const variantIds = [...new Set([...rowsByKey.values()].map((r) => r.variant_id).filter(Boolean))];
  const productMap = new Map();
  if (productIds.length) {
    const ph = productIds.map(() => '?').join(', ');
    for (const p of queryAll(
      `SELECT p.id, p.name, p.unit, p.category_id, c.name AS category_name
       FROM products p LEFT JOIN product_categories c ON c.id = p.category_id
       WHERE p.id IN (${ph})`,
      productIds,
    )) productMap.set(p.id, p);
  }
  const variantMap = new Map();
  if (variantIds.length) {
    const ph = variantIds.map(() => '?').join(', ');
    for (const v of queryAll(`SELECT id, name FROM product_variants WHERE id IN (${ph})`, variantIds)) {
      variantMap.set(v.id, v.name);
    }
  }
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  const categoryId = filters.category_id || null;
  const rows = [];
  for (const row of rowsByKey.values()) {
    const product = productMap.get(row.product_id);
    if (categoryId && product?.category_id !== categoryId) continue;
    let inTotal = 0;
    let outTotal = 0;
    for (const k of MOVEMENT_KINDS) {
      row.movements[k.key] = round3(row.movements[k.key]);
      if (k.dir === 'in') inTotal += row.movements[k.key];
      else outTotal += row.movements[k.key];
    }
    const opening = round3(row.opening);
    const closing = round3(opening + inTotal - outTotal);
    if (Math.abs(opening) <= EPS && inTotal <= EPS && outTotal <= EPS) continue;
    const variantName = row.variant_id ? variantMap.get(row.variant_id) : null;
    rows.push({
      product_id: row.product_id,
      variant_id: row.variant_id,
      department_id: row.department_id,
      department_name: deptName.get(row.department_id) || '—',
      name: `${product?.name || 'Товар'}${variantName ? ` — ${variantName}` : ''}`,
      unit: product?.unit || 'шт',
      category_id: product?.category_id || null,
      category_name: product?.category_name || null,
      opening,
      movements: row.movements,
      in_total: round3(inTotal),
      out_total: round3(outTotal),
      closing,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.department_name.localeCompare(b.department_name, 'ru'));

  return {
    date_from: dateFrom,
    date_to: dateTo,
    department_id: filters.department_id || null,
    departments,
    kinds: MOVEMENT_KINDS,
    rows,
  };
}

/** Документы по одному товару (вариант/отдел) за период с нарастающим остатком. */
export function getStockMovementDetails(branchId = DEFAULT_BRANCH_ID, filters = {}) {
  const productId = filters.product_id;
  if (!productId) throw new Error('Укажите товар');
  const dateFrom = filters.date_from || null;
  const dateTo = filters.date_to || null;
  assertDate(dateFrom, 'С');
  assertDate(dateTo, 'По');

  const { departments, departmentIds } = resolveDepartmentIds(branchId, filters.department_id || null);
  const variantId = Object.prototype.hasOwnProperty.call(filters, 'variant_id')
    ? (filters.variant_id || null)
    : undefined;
  const events = collectEvents(branchId, { dateTo, departmentIds, productId, variantId });
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  let balance = 0;
  let opening = 0;
  const lines = [];
  for (const e of events) {
    balance += e.qty;
    if (dateFrom && e.date < dateFrom) {
      opening = balance;
      continue;
    }
    lines.push({
      date: e.date,
      doc_id: e.doc_id,
      doc_type: e.doc_type,
      doc_number: e.doc_number,
      is_remainder: e.is_remainder,
      department_name: deptName.get(e.department_id) || '—',
      kind: e.kind,
      kind_label: KIND_LABEL[e.kind],
      in_qty: e.qty > 0 ? round3(e.qty) : 0,
      out_qty: e.qty < 0 ? round3(-e.qty) : 0,
      balance: round3(balance),
    });
  }
  return { opening: round3(opening), closing: round3(balance), lines };
}
