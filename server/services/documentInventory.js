import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { assertDepartmentInBranch, syncBranchStockFromDepartments } from '../departments.js';
import {
  getDepartmentAvgCost,
  getBranchAvgCost,
  getDepartmentStockWithCost,
  issueDepartmentStock,
  receiveDepartmentStock,
  reverseIssueDepartmentStock,
  reverseReceiveDepartmentStock,
} from '../inventoryCost.js';
import { getStockReport } from './reports.js';
import { getCashArticle, getCashArticles } from '../cashArticles.js';
import { SHORTAGE_ARTICLE_CODE, cashArticleId } from '../cashArticleDefaults.js';
import {
  addHistory,
  afterVariantStockChange,
  generateDocNumber,
  getItemStockLabel,
  itemStockQty,
  roundMoney,
  updateStock,
} from './documentCore.js';

const { queryAll, queryOne, run } = db;

function inventoryLineDiff(item) {
  return itemStockQty(item) - (Number(item.book_qty) || 0);
}

function inventoryLineCost(item) {
  const stored = Number(item.unit_cost);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return Math.max(0, Number(item.price) || 0);
}

export function inventoryTotals(items) {
  let shortage = 0;
  let surplus = 0;
  for (const item of items || []) {
    const diff = inventoryLineDiff(item);
    const amount = roundMoney(Math.abs(diff) * inventoryLineCost(item));
    if (diff < -1e-9) shortage += amount;
    else if (diff > 1e-9) surplus += amount;
  }
  return { shortage: roundMoney(shortage), surplus: roundMoney(surplus), net: roundMoney(shortage - surplus) };
}

export function normalizeInventoryItems(items) {
  const valid = (items || []).filter((i) => i.product_id);
  if (valid.length === 0) {
    throw new Error('Добавьте хотя бы один товар в документ');
  }
  const seen = new Set();
  return valid.map((item) => {
    const key = `${item.product_id}:${item.variant_id || ''}`;
    if (seen.has(key)) {
      throw new Error(`Товар «${getItemStockLabel(item)}» уже есть в документе`);
    }
    seen.add(key);
    const fact = Number(item.quantity);
    const book = Number(item.book_qty);
    if (!Number.isFinite(fact) || fact < 0) {
      throw new Error('Фактическое количество не может быть отрицательным');
    }
    if (!Number.isFinite(book) || book < 0) {
      throw new Error('Учётное количество не может быть отрицательным');
    }
    let netWeight = null;
    if (item.net_weight !== undefined && item.net_weight !== null && item.net_weight !== '') {
      const net = Number(item.net_weight);
      if (!Number.isFinite(net) || net < 0) {
        throw new Error('Нетто не может быть отрицательным');
      }
      netWeight = net > 0 ? net : null;
    }
    const cost = Math.max(0, Number(item.unit_cost ?? item.price) || 0);
    const factStock = netWeight > 0 ? netWeight * fact : fact;
    const amount = roundMoney(Math.abs(factStock - book) * cost);
    return {
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      quantity: fact,
      book_qty: book,
      net_weight: netWeight,
      price: cost,
      unit_cost: cost,
      amount,
      cost_amount: amount,
    };
  });
}

export function findOpenInventoryDraft(departmentId, branchId, exceptId = null) {
  if (!departmentId) return null;
  const params = [departmentId, branchId];
  let sql = `
    SELECT * FROM documents
    WHERE type = 'inventory' AND status = 'draft'
      AND to_department_id = ? AND branch_id = ?
      AND COALESCE(inventory_coverage, 'partial') != 'remainder'
  `;
  if (exceptId) {
    sql += ' AND id != ?';
    params.push(exceptId);
  }
  return queryOne(sql, params) || null;
}

export function assertNoOpenInventoryDraft(departmentId, branchId, exceptId = null) {
  const existing = findOpenInventoryDraft(departmentId, branchId, exceptId);
  if (existing) {
    throw new Error(`По этому отделу уже есть черновик инвентаризации №${existing.number}`);
  }
}

function inventoryLineKey(item) {
  return `${item.product_id}:${item.variant_id || ''}`;
}

export function inventoryItemFromStoredRow(row) {
  const net = Number(row.net_weight);
  return {
    product_id: row.product_id,
    variant_id: row.variant_id || null,
    quantity: Number(row.quantity) || 0,
    book_qty: Number(row.book_qty) || 0,
    net_weight: Number.isFinite(net) && net > 0 ? net : null,
    unit_cost: Number(row.unit_cost ?? row.price) || 0,
    price: Number(row.price ?? row.unit_cost) || 0,
    amount: Number(row.amount) || 0,
    cost_amount: Number(row.cost_amount ?? row.amount) || 0,
  };
}

export function mergeNormalizedInventoryItems(baseItems, incomingItems) {
  const byKey = new Map();
  for (const item of baseItems || []) {
    byKey.set(inventoryLineKey(item), item);
  }
  for (const item of incomingItems || []) {
    byKey.set(inventoryLineKey(item), item);
  }
  return [...byKey.values()];
}

export function normalizeInventoryCoverage(value, existing = null) {
  const raw = value ?? existing?.inventory_coverage ?? 'partial';
  const coverage = raw || 'partial';
  if (coverage === 'remainder') {
    throw new Error('Документ списания непересчитанного создаётся автоматически');
  }
  if (coverage !== 'partial' && coverage !== 'full') {
    throw new Error('Выберите частичную или полную инвентаризацию');
  }
  return coverage;
}

export function assertExpenseArticle(articleId, branchId) {
  if (!articleId) throw new Error('Выберите статью списания');
  const article = getCashArticle(articleId, branchId);
  if (!article || !article.active) throw new Error('Статья не найдена');
  if (article.direction !== 'expense') throw new Error('Для списания нужна статья расхода');
  return article;
}

export function normalizeInventoryLiable(data, branchId, existing = null) {
  const userId = data.liable_user_id !== undefined
    ? (data.liable_user_id || null)
    : (existing?.liable_user_id || null);
  const deptId = data.liable_department_id !== undefined
    ? (data.liable_department_id || null)
    : (existing?.liable_department_id || null);
  if (userId && deptId) {
    throw new Error('Выберите либо сотрудника, либо отдел');
  }
  if (userId) {
    const user = queryOne('SELECT id, name, branch_id, active FROM users WHERE id = ?', [userId]);
    if (!user || !user.active) throw new Error('Сотрудник не найден');
    if (user.branch_id && user.branch_id !== branchId) {
      throw new Error('Сотрудник принадлежит другому филиалу');
    }
  }
  if (deptId) {
    assertDepartmentInBranch(deptId, branchId);
  }
  return { liable_user_id: userId || null, liable_department_id: deptId || null };
}

export function findInventoryRemainder(parentId) {
  if (!parentId) return null;
  return queryOne(`
    SELECT * FROM documents
    WHERE type = 'inventory'
      AND inventory_coverage = 'remainder'
      AND source_document_id = ?
    ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
             created_at DESC
    LIMIT 1
  `, [parentId]);
}

function remainderPaidAmount(remainderId) {
  if (!remainderId) return 0;
  const row = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as paid
     FROM payments
     WHERE document_id = ? AND type = 'other_income'`,
    [remainderId],
  );
  return Number(row?.paid) || 0;
}

function mapRemainderSummary(row) {
  if (!row) return null;
  const paid = remainderPaidAmount(row.id);
  const total = Number(row.total_amount) || 0;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    date: row.date,
    total_amount: total,
    article_id: row.article_id || null,
    article_name: row.article_name || null,
    liable_user_id: row.liable_user_id || null,
    liable_user_name: row.liable_user_name || null,
    liable_department_id: row.liable_department_id || null,
    liable_department_name: row.liable_department_name || null,
    paid,
    balance: roundMoney(total - paid),
  };
}

export function loadRemainderSummary(parentId) {
  if (!parentId) return null;
  const row = queryOne(`
    SELECT rem.*,
           u.name as liable_user_name,
           dep.name as liable_department_name,
           ca.name as article_name
    FROM documents rem
    LEFT JOIN users u ON u.id = rem.liable_user_id
    LEFT JOIN departments dep ON dep.id = rem.liable_department_id
    LEFT JOIN cash_articles ca ON ca.id = rem.article_id
    WHERE rem.type = 'inventory'
      AND rem.inventory_coverage = 'remainder'
      AND rem.source_document_id = ?
    ORDER BY CASE rem.status WHEN 'confirmed' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
             rem.created_at DESC
    LIMIT 1
  `, [parentId]);
  return mapRemainderSummary(row);
}

export function attachRemaindersToDocuments(docs) {
  const parents = (docs || []).filter(
    (d) => d.type === 'inventory' && d.inventory_coverage !== 'remainder',
  );
  if (!parents.length) return docs;
  const ids = parents.map((d) => d.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = queryAll(`
    SELECT rem.*,
           u.name as liable_user_name,
           dep.name as liable_department_name,
           ca.name as article_name
    FROM documents rem
    LEFT JOIN users u ON u.id = rem.liable_user_id
    LEFT JOIN departments dep ON dep.id = rem.liable_department_id
    LEFT JOIN cash_articles ca ON ca.id = rem.article_id
    WHERE rem.type = 'inventory'
      AND rem.inventory_coverage = 'remainder'
      AND rem.source_document_id IN (${placeholders})
    ORDER BY CASE rem.status WHEN 'confirmed' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
             rem.created_at DESC
  `, ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.source_document_id)) {
      map.set(row.source_document_id, mapRemainderSummary(row));
    }
  }
  return docs.map((doc) => (
    doc.type === 'inventory'
      ? { ...doc, remainder_document: map.get(doc.id) || null }
      : doc
  ));
}

export function attachInventoryListAmounts(docs) {
  const inventoryDocs = (docs || []).filter((d) => d.type === 'inventory');
  if (!inventoryDocs.length) return docs;
  const ids = inventoryDocs.map((d) => d.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = queryAll(
    `SELECT document_id, product_id, variant_id, quantity, book_qty, unit_cost, price
     FROM document_items
     WHERE document_id IN (${placeholders})`,
    ids,
  );
  const byDoc = new Map();
  for (const row of rows) {
    const list = byDoc.get(row.document_id) || [];
    list.push(row);
    byDoc.set(row.document_id, list);
  }
  return docs.map((doc) => {
    if (doc.type !== 'inventory') return doc;
    const fields = inventoryStockAmountFields(doc, byDoc.get(doc.id) || []);
    return {
      ...doc,
      counted_amount: fields.counted_amount,
      remainder_amount: fields.remainder_amount,
      stock_amount: fields.stock_amount,
      shortage_total: fields.shortage_total,
      surplus_total: fields.surplus_total,
    };
  });
}

function mapInventoryWriteoffItem(item) {
  const book = Number(item.book_qty) || 0;
  const cost = Number(item.unit_cost) || Number(item.price) || 0;
  const amount = Number.isFinite(Number(item.amount)) && Number(item.amount) !== 0
    ? roundMoney(Number(item.amount))
    : roundMoney(book * cost);
  const productName = item.product_name
    || item.name
    || (item.variant_name ? `${item.product_name || ''} — ${item.variant_name}`.trim() : '');
  return {
    product_id: item.product_id,
    variant_id: item.variant_id || null,
    product_name: productName || getItemStockLabel(item),
    unit: item.unit || 'шт',
    book_qty: book,
    quantity: Number(item.quantity) || 0,
    unit_cost: cost,
    price: cost,
    amount,
  };
}

function collectInventoryLeftovers(departmentId, branchId, countedItems) {
  const counted = new Set((countedItems || []).map(inventoryLineKey));
  const rows = getStockReport(branchId, departmentId, true);
  const leftovers = [];
  for (const row of rows) {
    const key = `${row.product_id}:${row.variant_id || ''}`;
    if (counted.has(key)) continue;
    const stock = Number(row.stock) || 0;
    if (stock <= 1e-9) continue;
    const cost = Number(row.unitCost) || 0;
    const amount = roundMoney(stock * cost);
    leftovers.push({
      product_id: row.product_id,
      variant_id: row.variant_id || null,
      product_name: row.name,
      unit: row.unit || 'шт',
      quantity: 0,
      book_qty: stock,
      price: cost,
      unit_cost: cost,
      amount,
      cost_amount: amount,
    });
  }
  return leftovers;
}

function loadRemainderWriteoffItems(remainderId) {
  if (!remainderId) return [];
  const rows = queryAll(`
    SELECT di.*, p.name as product_name, p.unit, pv.name as variant_name
    FROM document_items di
    JOIN products p ON p.id = di.product_id
    LEFT JOIN product_variants pv ON pv.id = di.variant_id
    WHERE di.document_id = ?
    ORDER BY COALESCE(di.sort_order, 0) ASC, di.id ASC
  `, [remainderId]);
  return rows.map((row) => mapInventoryWriteoffItem({
    ...row,
    product_name: row.variant_name
      ? `${row.product_name} — ${row.variant_name}`
      : row.product_name,
  }));
}

export function reverseInventoryRemainder(parentId, userId = null) {
  const remainder = findInventoryRemainder(parentId);
  if (!remainder) return;
  if (remainder.status === 'confirmed') {
    updateStock(remainder.id, true);
  }
  run(
    `UPDATE documents SET status='cancelled', updated_at=datetime('now') WHERE id=?`,
    [remainder.id],
  );
  addHistory(remainder.id, 'cancelled', userId);
}

export function createInventoryRemainderWriteoff(parent, countedItems, userId = null) {
  if (!parent || parent.inventory_coverage !== 'full') return null;
  const leftovers = collectInventoryLeftovers(
    parent.to_department_id,
    parent.branch_id || DEFAULT_BRANCH_ID,
    countedItems,
  );
  if (!leftovers.length) return null;
  assertExpenseArticle(parent.article_id, parent.branch_id || DEFAULT_BRANCH_ID);
  validateInventoryShortage(parent.to_department_id, leftovers);

  const id = uuidv4();
  const branchId = parent.branch_id || DEFAULT_BRANCH_ID;
  const number = generateDocNumber(branchId, 'inventory');
  const totals = inventoryTotals(leftovers);
  const comment = `Списание непересчитанного к инвентаризации №${parent.number}`;

  run(`
    INSERT INTO documents (
      id, number, type, counterparty_id, date, comment, from_location, to_location,
      branch_id, from_branch_id, to_branch_id, from_department_id, to_department_id,
      source_document_id, total_amount, status,
      inventory_coverage, article_id, liable_user_id, liable_department_id
    )
    VALUES (?, ?, 'inventory', NULL, ?, ?, '', '', ?, NULL, NULL, NULL, ?, ?, ?, 'confirmed',
      'remainder', ?, ?, ?)
  `, [
    id,
    number,
    parent.date,
    comment,
    branchId,
    parent.to_department_id,
    parent.id,
    totals.net,
    parent.article_id,
    parent.liable_user_id || null,
    parent.liable_department_id || null,
  ]);
  persistInventoryItems(id, leftovers);
  addHistory(id, 'created', userId);
  const remDoc = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  const remItems = queryAll('SELECT * FROM document_items WHERE document_id = ?', [id]);
  applyInventoryStock(remDoc, remItems, false);
  addHistory(id, 'confirmed', userId);
  return id;
}

export function getInventoryConfirmOptions(branchId = DEFAULT_BRANCH_ID) {
  const expenseArticles = getCashArticles('expense', branchId);
  const defaultArticleId = cashArticleId(branchId, SHORTAGE_ARTICLE_CODE);
  const users = queryAll(`
    SELECT id, name, department_id
    FROM users
    WHERE active = 1 AND branch_id = ?
    ORDER BY name
  `, [branchId]);
  return {
    expense_articles: expenseArticles,
    default_article_id: defaultArticleId,
    users,
  };
}

function prihodLineUnitCost(row) {
  const qty = itemStockQty(row);
  const storedAmount = Number(row.amount);
  const lineAmount = Number.isFinite(storedAmount)
    ? storedAmount
    : (Number(row.quantity) || 0) * (Number(row.price) || 0);
  if (qty <= 0 || lineAmount <= 0) return 0;
  return lineAmount / qty;
}

function lastPrihodUnitCostMap(departmentId) {
  const rows = queryAll(`
    SELECT di.product_id, di.variant_id, di.quantity, di.price, di.amount, di.net_weight
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    WHERE d.type = 'prihod' AND d.status = 'confirmed' AND d.to_department_id = ?
    ORDER BY d.date DESC, d.created_at DESC
  `, [departmentId]);
  const map = new Map();
  for (const row of rows) {
    const key = `${row.product_id}:${row.variant_id || ''}`;
    if (map.has(key)) continue;
    map.set(key, prihodLineUnitCost(row));
  }
  return map;
}

function lastPrihodUnitCost(departmentId, productId, variantId = null) {
  const row = queryOne(`
    SELECT di.quantity, di.price, di.amount, di.net_weight
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    WHERE d.type = 'prihod' AND d.status = 'confirmed'
      AND d.to_department_id = ?
      AND di.product_id = ?
      AND IFNULL(di.variant_id, '') = IFNULL(?, '')
    ORDER BY d.date DESC, d.created_at DESC
    LIMIT 1
  `, [departmentId, productId, variantId || null]);
  if (!row) return 0;
  return prihodLineUnitCost(row);
}

function lastPrihodUnitCostInBranch(branchId, productId, variantId = null) {
  if (!branchId) return 0;
  const row = queryOne(`
    SELECT di.quantity, di.price, di.amount, di.net_weight
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    WHERE d.type = 'prihod' AND d.status = 'confirmed'
      AND d.branch_id = ?
      AND di.product_id = ?
      AND IFNULL(di.variant_id, '') = IFNULL(?, '')
    ORDER BY d.date DESC, d.created_at DESC
    LIMIT 1
  `, [branchId, productId, variantId || null]);
  if (!row) return 0;
  return prihodLineUnitCost(row);
}

function departmentBranchId(departmentId) {
  return queryOne('SELECT branch_id FROM departments WHERE id = ?', [departmentId])?.branch_id
    || DEFAULT_BRANCH_ID;
}

function resolveInventorySurplusCost(departmentId, productId, variantId, fallback) {
  const live = getDepartmentAvgCost(departmentId, productId, variantId);
  if (live > 0) return live;
  const stored = Math.max(0, Number(fallback) || 0);
  if (stored > 0) return stored;
  const branchId = departmentBranchId(departmentId);
  const branchAvg = getBranchAvgCost(branchId, productId, variantId);
  if (branchAvg > 0) return branchAvg;
  const last = lastPrihodUnitCost(departmentId, productId, variantId);
  if (last > 0) return last;
  const lastBranch = lastPrihodUnitCostInBranch(branchId, productId, variantId);
  if (lastBranch > 0) return lastBranch;
  throw new Error(
    `Укажите себестоимость излишка «${getItemStockLabel({ product_id: productId, variant_id: variantId })}»: на складе нет средней цены`,
  );
}

function inventoryItemDisplayCost(departmentId, item) {
  const stored = inventoryLineCost(item);
  if (stored > 0) return stored;
  if (!departmentId || !item?.product_id) return 0;
  try {
    return resolveInventorySurplusCost(
      departmentId,
      item.product_id,
      item.variant_id || null,
      0,
    );
  } catch {
    return 0;
  }
}

function applyInventoryItemCosts(departmentId, items) {
  return (items || []).map((item) => {
    const cost = inventoryItemDisplayCost(departmentId, item);
    const factStock = itemStockQty(item);
    const book = Number(item.book_qty) || 0;
    const amount = roundMoney(Math.abs(factStock - book) * cost);
    return {
      ...item,
      unit_cost: cost,
      price: cost || Number(item.price) || 0,
      amount,
      cost_amount: amount,
      stock_amount: roundMoney(factStock * cost),
    };
  });
}

function inventoryCountedStockAmount(items) {
  return roundMoney((items || []).reduce((sum, item) => (
    sum + (Number(item.stock_amount) || (itemStockQty(item) * inventoryLineCost(item)))
  ), 0));
}

export function inventoryStockAmountFields(doc, items, { includeWriteoffItems = false } = {}) {
  const priced = applyInventoryItemCosts(doc.to_department_id, items);
  const counted_amount = inventoryCountedStockAmount(priced);
  let remainder_amount = 0;
  let remainder_items = [];
  if (doc.inventory_coverage === 'full') {
    if (doc.status === 'confirmed') {
      remainder_amount = Number(doc.remainder_document?.total_amount) || 0;
      if (includeWriteoffItems) {
        remainder_items = loadRemainderWriteoffItems(doc.remainder_document?.id);
      }
    } else {
      const leftovers = collectInventoryLeftovers(
        doc.to_department_id,
        doc.branch_id || DEFAULT_BRANCH_ID,
        priced,
      );
      remainder_amount = roundMoney(leftovers.reduce((sum, item) => (
        sum + (Number(item.amount) || 0)
      ), 0));
      if (includeWriteoffItems) {
        remainder_items = leftovers.map(mapInventoryWriteoffItem);
      }
    }
  }
  const totals = inventoryTotals(priced);
  return {
    items: priced,
    counted_amount,
    remainder_amount,
    remainder_items,
    stock_amount: roundMoney(counted_amount + remainder_amount),
    shortage_total: totals.shortage,
    surplus_total: totals.surplus,
  };
}

export function applyInventoryBookSnapshot(departmentId, items) {
  return (items || []).map((item) => {
    const vid = item.variant_id || null;
    const { stock, avgCost } = getDepartmentStockWithCost(departmentId, item.product_id, vid);
    const fact = itemStockQty(item);
    const book = Number(stock) || 0;
    let cost = avgCost > 0 ? avgCost : inventoryLineCost(item);
    if (fact - book > 1e-9 && !(cost > 0)) {
      cost = resolveInventorySurplusCost(departmentId, item.product_id, vid, cost);
    }
    const amount = roundMoney(Math.abs(fact - book) * cost);
    return {
      ...item,
      book_qty: book,
      price: cost,
      unit_cost: cost,
      amount,
      cost_amount: amount,
    };
  });
}

export function writeInventoryBookSnapshot(items) {
  for (const item of items) {
    if (!item.id) continue;
    run(
      `UPDATE document_items
       SET book_qty = ?, unit_cost = ?, price = ?, amount = ?, cost_amount = ?
       WHERE id = ?`,
      [item.book_qty, item.unit_cost, item.price, item.amount, item.cost_amount, item.id],
    );
  }
}

export function persistInventoryItems(documentId, items) {
  items.forEach((item, idx) => {
    run(`
      INSERT INTO document_items (
        id, document_id, product_id, variant_id, quantity, price, amount,
        item_role, unit_cost, cost_amount, book_qty, net_weight, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'input', ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      documentId,
      item.product_id,
      item.variant_id || null,
      item.quantity,
      item.price,
      item.amount,
      item.unit_cost,
      item.cost_amount,
      item.book_qty,
      item.net_weight ?? null,
      idx,
    ]);
  });
}

export function validateInventoryShortage(departmentId, items) {
  if (!departmentId) throw new Error('Выберите отдел для инвентаризации');
  for (const item of items) {
    const shortage = -inventoryLineDiff(item);
    if (shortage <= 1e-9) continue;
    const { stock } = getDepartmentStockWithCost(departmentId, item.product_id, item.variant_id || null);
    if (stock + 1e-9 < shortage) {
      throw new Error(`Недостаточно остатка «${getItemStockLabel(item)}» для списания недостачи (есть ${stock})`);
    }
  }
}

export function applyInventoryStock(doc, items, reverse) {
  const departmentId = doc.to_department_id;
  if (!departmentId) throw new Error('Выберите отдел для инвентаризации');
  const branchId = doc.branch_id || DEFAULT_BRANCH_ID;

  for (const item of items) {
    const diff = inventoryLineDiff(item);
    const qty = Math.abs(diff);
    if (qty <= 1e-9) continue;
    const vid = item.variant_id || null;
    const storedCost = inventoryLineCost(item);

    if (!reverse) {
      if (diff > 0) {
        const unitCost = resolveInventorySurplusCost(departmentId, item.product_id, vid, storedCost);
        receiveDepartmentStock(departmentId, item.product_id, qty, unitCost, vid);
        const amount = roundMoney(qty * unitCost);
        run(
          'UPDATE document_items SET unit_cost = ?, price = ?, amount = ?, cost_amount = ? WHERE id = ?',
          [unitCost, unitCost, amount, amount, item.id],
        );
      } else {
        const issued = issueDepartmentStock(departmentId, item.product_id, qty, vid);
        const unitCost = issued.unitCost || storedCost;
        const amount = roundMoney(qty * unitCost);
        run(
          'UPDATE document_items SET unit_cost = ?, price = ?, amount = ?, cost_amount = ? WHERE id = ?',
          [unitCost, unitCost, amount, amount, item.id],
        );
      }
    } else if (diff > 0) {
      reverseReceiveDepartmentStock(departmentId, item.product_id, qty, storedCost, vid);
    } else {
      reverseIssueDepartmentStock(departmentId, item.product_id, qty, storedCost, vid);
    }

    afterVariantStockChange(vid, item.product_id, branchId);
    syncBranchStockFromDepartments(branchId, item.product_id);
  }

  const refreshed = queryAll('SELECT * FROM document_items WHERE document_id = ?', [doc.id]);
  const totals = inventoryTotals(refreshed);
  run('UPDATE documents SET total_amount = ? WHERE id = ?', [totals.net, doc.id]);
}

export function getInventoryStockSnapshot(departmentId, branchId = DEFAULT_BRANCH_ID, productId = null, variantId = null) {
  if (!departmentId) throw new Error('Выберите отдел');
  assertDepartmentInBranch(departmentId, branchId);
  if (productId) {
    const product = queryOne('SELECT id, name, unit, net_weight FROM products WHERE id = ?', [productId]);
    if (!product) throw new Error('Товар не найден');
    let name = product.name;
    let unit = product.unit || 'шт';
    const vid = variantId || null;
    let variantName = null;
    if (vid) {
      const variant = queryOne(
        'SELECT name FROM product_variants WHERE id = ? AND product_id = ?',
        [vid, productId],
      );
      if (!variant) throw new Error('Вариант не найден');
      variantName = variant.name;
      name = `${product.name} — ${variant.name}`;
    }
    const { stock, avgCost } = getDepartmentStockWithCost(departmentId, productId, vid);
    const avg = Number(avgCost) || 0;
    const net = Number(product.net_weight) || 0;
    return [{
      product_id: productId,
      variant_id: vid,
      name,
      variant_name: variantName,
      unit,
      net_weight: net > 0 ? net : null,
      book_qty: Number(stock) || 0,
      avg_cost: avg,
      suggest_cost: avg > 0 ? 0 : lastPrihodUnitCost(departmentId, productId, vid),
    }];
  }
  const lastMap = lastPrihodUnitCostMap(departmentId);
  return getStockReport(branchId, departmentId, true).map((row) => {
    const vid = row.variant_id || null;
    const avg = Number(row.unitCost) || 0;
    const net = Number(row.net_weight) || 0;
    return {
      product_id: row.product_id,
      variant_id: vid,
      name: row.name,
      variant_name: row.variant_name || null,
      unit: row.unit,
      net_weight: net > 0 ? net : null,
      book_qty: Number(row.stock) || 0,
      avg_cost: avg,
      suggest_cost: avg > 0 ? 0 : (lastMap.get(`${row.product_id}:${vid || ''}`) || 0),
    };
  });
}
