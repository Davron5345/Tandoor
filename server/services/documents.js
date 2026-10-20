import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { getBranchStock, DEFAULT_BRANCH_ID } from '../branches.js';
import { assertDepartmentInBranch, getDefaultDepartmentId, getDepartmentStock } from '../departments.js';
import { getVariantBranchStock } from '../inventoryCost.js';
import { applyDishSaleConsumption, buildDishSalePlan } from '../dishSales.js';
import { DEFAULT_CONTRACT_ID, isSupplierCounterpartyDoc, assertCounterpartyBranch } from './counterparties.js';
import { allocateExtraCosts, extraCostsTotal, capitalizedExtraTotal, normalizeExtraCosts } from '../documentExtraCosts.js';
import { assertNoLaterStockMovements } from '../stockMovementGuard.js';
import { buildDocumentHistoryDiff } from '../documentHistoryDiff.js';
import { listDocumentAttachments, deleteAllDocumentAttachments } from '../documentAttachments.js';
import { snapshotDocument } from '../documentSnapshot.js';
import { telegramUrlFromInboxRow } from '../telegramLinks.js';
import {
  addHistory,
  generateDocNumber,
  getItemStockLabel,
  isOutgoingDocType,
  itemLineAmount,
  itemStockQty,
  roundMoney,
  updateStock,
} from './documentCore.js';
import {
  applyInventoryBookSnapshot,
  assertExpenseArticle,
  assertNoOpenInventoryDraft,
  attachInventoryListAmounts,
  attachRemaindersToDocuments,
  createInventoryRemainderWriteoff,
  findInventoryRemainder,
  findOpenInventoryDraft,
  inventoryItemFromStoredRow,
  inventoryStockAmountFields,
  inventoryTotals,
  loadRemainderSummary,
  mergeNormalizedInventoryItems,
  normalizeInventoryCoverage,
  normalizeInventoryItems,
  normalizeInventoryLiable,
  persistInventoryItems,
  reverseInventoryRemainder,
  validateInventoryShortage,
  writeInventoryBookSnapshot,
} from './documentInventory.js';
import {
  buildRazdelkaOutputItemsFromInput,
  calcRazdelkaTotal,
  enrichRazdelkaItemPrices,
  normalizeRazdelkaItems,
  prepareRazdelkaOutputs,
  validateRazdelka,
} from './documentRazdelka.js';

export { addHistory } from './documentCore.js';
export { getInventoryStockSnapshot, getInventoryConfirmOptions } from './documentInventory.js';

const { queryAll, queryOne, run, transaction } = db;

function lookupTelegramInboxForDocument(documentId) {
  if (!documentId) return null;
  return queryOne(`
    SELECT chat_id, thread_id, message_id, source
    FROM telegram_inbox
    WHERE document_id = ?
      AND chat_id IS NOT NULL AND chat_id != '' AND chat_id != 'paste'
      AND message_id IS NOT NULL AND message_id != ''
    ORDER BY part ASC
    LIMIT 1
  `, [documentId]);
}

function telegramSourceForDocument(documentId) {
  const inbox = lookupTelegramInboxForDocument(documentId);
  const url = telegramUrlFromInboxRow(inbox);
  if (!url) return { telegram_url: null };
  return { telegram_url: url };
}

/** Пакетно добавить telegram_url к списку документов (из telegram_inbox). */
function attachTelegramUrlsToDocuments(rows) {
  if (!rows?.length) return rows || [];
  const ids = [...new Set(rows.map((r) => r.id).filter(Boolean))];
  if (!ids.length) return rows;
  const placeholders = ids.map(() => '?').join(',');
  const links = queryAll(`
    SELECT document_id, chat_id, thread_id, message_id
    FROM telegram_inbox
    WHERE document_id IN (${placeholders})
      AND chat_id IS NOT NULL AND chat_id != '' AND chat_id != 'paste'
      AND message_id IS NOT NULL AND message_id != ''
    ORDER BY part ASC
  `, ids);
  const map = new Map();
  for (const row of links) {
    if (map.has(row.document_id)) continue;
    const url = telegramUrlFromInboxRow(row);
    if (url) map.set(row.document_id, url);
  }
  return rows.map((r) => ({ ...r, telegram_url: map.get(r.id) || null }));
}

export function getNextDocNumber(branchId = DEFAULT_BRANCH_ID, docType) {
  return generateDocNumber(branchId, docType);
}

function resolveDocumentContractId(contractId, counterpartyId, branchId = DEFAULT_BRANCH_ID) {
  if (!contractId || contractId === DEFAULT_CONTRACT_ID) return null;
  if (!counterpartyId) throw new Error('Выберите контрагента для договора');
  const contract = queryOne(
    'SELECT id FROM counterparty_contracts WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [contractId, counterpartyId, branchId],
  );
  if (!contract) throw new Error('Договор не найден');
  return contract.id;
}

function normalizeIsoDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function assertReturnSupplierSourceDocument(sourceDocumentId, branchId, supplierId, returnDate = null) {
  if (!sourceDocumentId) throw new Error('Выберите приходный документ для возврата');
  const doc = queryOne(
    'SELECT id, type, status, branch_id, counterparty_id FROM documents WHERE id = ?',
    [sourceDocumentId],
  );
  if (!doc) throw new Error('Приходный документ не найден');
  if (doc.type !== 'prihod') throw new Error('Для возврата можно выбрать только приходный документ');
  if (doc.status !== 'confirmed') throw new Error('Возврат привязывается только к проведённому приходу');
  if ((doc.branch_id || DEFAULT_BRANCH_ID) !== (branchId || DEFAULT_BRANCH_ID)) {
    throw new Error('Приходный документ относится к другому филиалу');
  }
  if (!doc.counterparty_id || doc.counterparty_id !== supplierId) {
    throw new Error('Приходный документ не относится к выбранному поставщику');
  }
  const sourceDate = normalizeIsoDate(doc.date);
  const targetDate = normalizeIsoDate(returnDate);
  if (sourceDate && targetDate && targetDate < sourceDate) {
    throw new Error('Дата возврата не может быть раньше даты приходного документа');
  }
  return doc;
}

function assertReturnCustomerSourceDocument(sourceDocumentId, branchId, clientId, returnDate = null) {
  if (!sourceDocumentId) throw new Error('Выберите расходный документ для возврата');
  const doc = queryOne(
    'SELECT id, type, status, branch_id, counterparty_id FROM documents WHERE id = ?',
    [sourceDocumentId],
  );
  if (!doc) throw new Error('Расходный документ не найден');
  if (doc.type !== 'rashod') throw new Error('Для возврата можно выбрать только расходный документ');
  if (doc.status !== 'confirmed') throw new Error('Возврат привязывается только к проведённому расходу');
  if ((doc.branch_id || DEFAULT_BRANCH_ID) !== (branchId || DEFAULT_BRANCH_ID)) {
    throw new Error('Расходный документ относится к другому филиалу');
  }
  if (!doc.counterparty_id || doc.counterparty_id !== clientId) {
    throw new Error('Расходный документ не относится к выбранному клиенту');
  }
  const sourceDate = normalizeIsoDate(doc.date);
  const targetDate = normalizeIsoDate(returnDate);
  if (sourceDate && targetDate && targetDate < sourceDate) {
    throw new Error('Дата возврата не может быть раньше даты расходного документа');
  }
  return doc;
}

function findSourceLineMetrics(sourceItems, productId, variantId) {
  const matches = sourceItems.filter(
    (item) => item.product_id === productId
      && (item.variant_id || null) === (variantId || null),
  );
  if (matches.length === 0) {
    throw new Error('Товар из возврата отсутствует в исходном документе');
  }
  const totalQty = matches.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const totalCost = matches.reduce(
    (sum, item) => sum + (Number(item.cost_amount) || (Number(item.unit_cost) || 0) * (Number(item.quantity) || 0)),
    0,
  );
  const totalAmount = matches.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return {
    unitCost: totalQty > 0 ? totalCost / totalQty : 0,
    salePrice: totalQty > 0 ? totalAmount / totalQty : 0,
    sourceQty: totalQty,
  };
}

function assertReturnQtyNotExceeded(sourceDocumentId, returnDocumentId, items) {
  for (const item of items) {
    const sourceItems = queryAll('SELECT * FROM document_items WHERE document_id = ?', [sourceDocumentId]);
    const { sourceQty } = findSourceLineMetrics(sourceItems, item.product_id, item.variant_id || null);

    const alreadyReturned = queryAll(`
      SELECT di.quantity, di.product_id, di.variant_id
      FROM document_items di
      JOIN documents d ON d.id = di.document_id
      WHERE d.source_document_id = ?
        AND d.status = 'confirmed'
        AND d.id != ?
        AND di.product_id = ?
        AND (di.variant_id IS ? OR di.variant_id = ?)
    `, [
      sourceDocumentId,
      returnDocumentId || '',
      item.product_id,
      item.variant_id || null,
      item.variant_id || null,
    ]).reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

    const requestedQty = Number(item.quantity) || 0;
    if (alreadyReturned + requestedQty > sourceQty) {
      const product = queryOne('SELECT name FROM products WHERE id = ?', [item.product_id]);
      throw new Error(
        `Превышено количество возврата «${product?.name || 'товар'}»: `
        + `источник ${sourceQty}, уже возвращено ${alreadyReturned}, запрошено ${requestedQty}`,
      );
    }
  }
}

function applyReturnCustomerLineCosts(documentId) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [documentId]);
  if (!doc || doc.type !== 'return_customer' || !doc.source_document_id) return;
  const items = queryAll('SELECT * FROM document_items WHERE document_id = ?', [documentId]);
  const sourceItems = queryAll('SELECT * FROM document_items WHERE document_id = ?', [doc.source_document_id]);
  for (const item of items) {
    const { unitCost } = findSourceLineMetrics(sourceItems, item.product_id, item.variant_id || null);
    const qty = Number(item.quantity) || 0;
    run(
      'UPDATE document_items SET unit_cost = ?, cost_amount = ? WHERE id = ?',
      [unitCost, unitCost * qty, item.id],
    );
  }
}

export { snapshotDocument };

function validateRashodStock(branchId, fromDepartmentId, items, reverse = false) {
  if (reverse) return;
  if (!fromDepartmentId) throw new Error('Выберите отдел для расхода/возврата');
  assertDepartmentInBranch(fromDepartmentId, branchId);
  for (const item of items) {
    const stock = getDepartmentStock(item.product_id, fromDepartmentId, item.variant_id || null);
    if (stock + 1e-9 < itemStockQty(item)) {
      const label = getItemStockLabel(item);
      throw new Error(`Недостаточно остатка «${label}» (есть ${stock})`);
    }
  }
}

/** Возврат поставщику списывает столько же склада на штуку, сколько пришло: нетто берём из строк прихода. */
function inheritReturnSupplierNet(items, sourceDocumentId) {
  if (!sourceDocumentId) return items;
  const sourceItems = queryAll(
    'SELECT product_id, variant_id, quantity, net_weight FROM document_items WHERE document_id = ?',
    [sourceDocumentId],
  );
  return items.map((item) => {
    if (Number(item.net_weight) > 0) return item;
    const matches = sourceItems.filter(
      (s) => s.product_id === item.product_id && (s.variant_id || null) === (item.variant_id || null),
    );
    const qty = matches.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
    const stock = matches.reduce((sum, s) => sum + itemStockQty(s), 0);
    const net = qty > 0 ? stock / qty : 0;
    return Math.abs(net - 1) > 1e-9 && net > 0 ? { ...item, net_weight: net } : item;
  });
}

function validateDepartmentTransfer(branchId, fromDept, toDept, items, reverse = false) {
  if (reverse) return;
  for (const item of items) {
    const label = getItemStockLabel(item);
    const qty = itemStockQty(item);
    if (fromDept && toDept) {
      const stock = getDepartmentStock(item.product_id, fromDept, item.variant_id || null);
      if (stock < qty) {
        throw new Error(`Недостаточно остатка «${label}» в отделе-отправителе (есть ${stock})`);
      }
    } else if (!fromDept && toDept) {
      const sourceDept = getDefaultDepartmentId(branchId);
      if (!sourceDept) throw new Error('Не найден отдел-источник');
      const stock = getDepartmentStock(item.product_id, sourceDept, item.variant_id || null);
      if (stock < qty) {
        throw new Error(`Недостаточно остатка «${label}» в отделе-источнике (есть ${stock})`);
      }
    } else if (fromDept && !toDept) {
      const stock = getDepartmentStock(item.product_id, fromDept, item.variant_id || null);
      if (stock < qty) {
        throw new Error(`Недостаточно остатка «${label}» в отделе (есть ${stock})`);
      }
    }
  }
}

const EDIT_CONFIRMED_ACTION = 'изменить проведённый документ';

function validatePeremeshchenie(fromBranchId, toBranchId, fromDept, toDept, items, reverse = false, checkStock = true) {
  if (fromDept || toDept) {
    if (fromBranchId !== toBranchId && !(fromDept && toDept)) {
      throw new Error('Для перемещения между отделами выберите один филиал');
    }
    if (fromDept && toDept && fromDept === toDept) {
      throw new Error('Отделы отправления и получения должны отличаться');
    }
    if (checkStock) validateDepartmentTransfer(fromBranchId, fromDept, toDept, items, reverse);
    return;
  }
  if (!toBranchId) throw new Error('Укажите филиал получателя');
  if (fromBranchId === toBranchId) throw new Error('Филиалы отправления и получения должны отличаться');
  if (checkStock) validateTransferStock(fromBranchId, items, reverse);
}

function validateTransferStock(fromBranchId, items, reverse = false) {
  if (reverse) {
    for (const item of items) {
      const stock = item.variant_id
        ? getVariantBranchStock(item.variant_id, fromBranchId)
        : getBranchStock(item.product_id, fromBranchId);
      if (stock < itemStockQty(item)) {
        throw new Error(`Недостаточно остатка «${getItemStockLabel(item)}» для отмены перемещения`);
      }
    }
    return;
  }
  const sourceDept = getDefaultDepartmentId(fromBranchId);
  if (!sourceDept) throw new Error('У филиала-отправителя нет активного отдела');
  const sourceDeptName = queryOne('SELECT name FROM departments WHERE id = ?', [sourceDept])?.name || 'основной';
  for (const item of items) {
    const stock = getDepartmentStock(item.product_id, sourceDept, item.variant_id || null);
    const qty = itemStockQty(item);
    if (stock + 1e-9 < qty) {
      const label = getItemStockLabel(item);
      throw new Error(`Недостаточно остатка «${label}» в отделе «${sourceDeptName}» филиала-отправителя (есть ${stock})`);
    }
  }
}

export function getDocuments(filters = {}) {
  const byProduct = Boolean(filters.product_id);
  let sql = `
    SELECT d.*, c.name as counterparty_name, c.type as counterparty_type,
           b.name as branch_name,
           fb.name as from_branch_name, tb.name as to_branch_name,
           fd.name as from_department_name, td.name as to_department_name,
           lu.name as liable_user_name, ld.name as liable_department_name,
           ica.name as article_name
           ${byProduct ? ', di.quantity, di.price, di.amount, di.net_weight' : ''}
    FROM documents d
    ${byProduct ? 'JOIN document_items di ON di.document_id = d.id' : ''}
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN branches b ON b.id = d.branch_id
    LEFT JOIN branches fb ON fb.id = d.from_branch_id
    LEFT JOIN branches tb ON tb.id = d.to_branch_id
    LEFT JOIN departments fd ON fd.id = d.from_department_id
    LEFT JOIN departments td ON td.id = d.to_department_id
    LEFT JOIN users lu ON lu.id = d.liable_user_id
    LEFT JOIN departments ld ON ld.id = d.liable_department_id
    LEFT JOIN cash_articles ica ON ica.id = d.article_id
    WHERE 1=1
  `;
  const params = [];

  if (filters.branch_id) {
    sql += ` AND (
      d.branch_id = ? OR d.from_branch_id = ? OR d.to_branch_id = ?
    )`;
    params.push(filters.branch_id, filters.branch_id, filters.branch_id);
  }
  if (filters.type) {
    sql += ' AND d.type = ?';
    params.push(filters.type);
    if (filters.type === 'inventory' && filters.inventory_coverage !== 'remainder' && !filters.include_remainder) {
      sql += " AND COALESCE(d.inventory_coverage, 'partial') != 'remainder'";
    }
    if (filters.inventory_coverage) {
      sql += ' AND d.inventory_coverage = ?';
      params.push(filters.inventory_coverage);
    }
  } else {
    sql += " AND d.type NOT IN ('supplier_price', 'opening_balance', 'inventory')";
  }
  if (filters.status) {
    sql += ' AND d.status = ?';
    params.push(filters.status);
  }
  if (filters.date_from) {
    sql += ' AND d.date >= ?';
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    sql += ' AND d.date <= ?';
    params.push(filters.date_to);
  }
  if (filters.counterparty_id) {
    sql += ' AND d.counterparty_id = ?';
    params.push(filters.counterparty_id);
  }
  if (byProduct) {
    sql += ' AND di.product_id = ?';
    params.push(filters.product_id);
    if (filters.variant_id != null && filters.variant_id !== '') {
      sql += ' AND (di.variant_id IS ? OR di.variant_id = ?)';
      params.push(filters.variant_id, filters.variant_id);
    }
  }
  if (filters.involving_department_id) {
    if (filters.direction === 'in') {
      sql += ' AND d.to_department_id = ?';
      params.push(filters.involving_department_id);
    } else if (filters.direction === 'out') {
      sql += ' AND d.from_department_id = ?';
      params.push(filters.involving_department_id);
    } else {
      sql += ' AND (d.from_department_id = ? OR d.to_department_id = ?)';
      params.push(filters.involving_department_id, filters.involving_department_id);
    }
  }

  sql += ' ORDER BY d.date DESC, d.created_at DESC';
  const rows = queryAll(sql, params);
  if (filters.type === 'inventory') {
    return attachInventoryListAmounts(attachRemaindersToDocuments(attachTelegramUrlsToDocuments(rows)));
  }
  return attachTelegramUrlsToDocuments(rows);
}

function assertActiveBranchOwnership(requestedBranchId, activeBranchId) {
  if (requestedBranchId && requestedBranchId !== activeBranchId) {
    throw new Error('Нет доступа к выбранному филиалу');
  }
}

/** Перемещение: списывать можно только со своего филиала (активный = источник). */
function resolveTransferBranchIds(data, activeBranchId, existing = null) {
  const fromBranchId = data.from_branch_id
    ?? existing?.from_branch_id
    ?? existing?.branch_id
    ?? activeBranchId;
  const toBranchId = data.to_branch_id
    ?? existing?.to_branch_id
    ?? fromBranchId;
  if (fromBranchId !== activeBranchId) {
    throw new Error('Списание возможно только со склада своего филиала');
  }
  return { docBranchId: fromBranchId, fromBranchId, toBranchId };
}

function documentVisibleInBranchSql(alias = 'd') {
  return `(${alias}.branch_id = ? OR ${alias}.from_branch_id = ? OR ${alias}.to_branch_id = ?)`;
}

export function getDocument(id, branchId = null) {
  const params = [id];
  let branchFilter = '';
  if (branchId) {
    branchFilter = ` AND ${documentVisibleInBranchSql('d')}`;
    params.push(branchId, branchId, branchId);
  }
  const doc = queryOne(`
    SELECT d.*, c.name as counterparty_name, c.type as counterparty_type,
           c.phone as counterparty_phone, c.telegram_chat_id,
           cc.number as contract_number, cc.date as contract_date,
           b.name as branch_name,
           fb.name as from_branch_name, tb.name as to_branch_name,
           fd.name as from_department_name, td.name as to_department_name,
           lu.name as liable_user_name, ld.name as liable_department_name,
           ica.name as article_name,
           cf.name as firm_name, cf.inn as firm_inn
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN counterparty_contracts cc ON cc.id = d.contract_id
    LEFT JOIN counterparty_firms cf ON cf.id = d.firm_id
    LEFT JOIN branches b ON b.id = d.branch_id
    LEFT JOIN branches fb ON fb.id = d.from_branch_id
    LEFT JOIN branches tb ON tb.id = d.to_branch_id
    LEFT JOIN departments fd ON fd.id = d.from_department_id
    LEFT JOIN departments td ON td.id = d.to_department_id
    LEFT JOIN users lu ON lu.id = d.liable_user_id
    LEFT JOIN departments ld ON ld.id = d.liable_department_id
    LEFT JOIN cash_articles ica ON ica.id = d.article_id
    WHERE d.id = ?${branchFilter}
  `, params);

  if (!doc) return null;

  if (!doc.contract_id) {
    doc.contract_number = 'Основной договор';
    doc.contract_date = null;
  }

  const stockBranch = branchId || doc.branch_id || DEFAULT_BRANCH_ID;
  const stockDepartmentId = isOutgoingDocType(doc.type)
    ? doc.from_department_id
    : doc.type === 'dish_sale'
      ? doc.from_department_id
      : doc.type === 'prihod' || doc.type === 'inventory'
      ? doc.to_department_id
      : doc.type === 'razdelka'
        ? doc.from_department_id
        : null;

  let itemsSql;
  let itemsParams;
  if (stockDepartmentId) {
    itemsSql = `
      SELECT di.*, p.name as product_name, p.sku, p.unit, pv.name as variant_name,
             COALESCE(pds.stock, 0) as stock,
             di.quantity as quantity, di.price as price, di.amount as amount,
             di.net_weight as net_weight, di.book_qty as book_qty, di.unit_cost as unit_cost
      FROM document_items di
      JOIN products p ON p.id = di.product_id
      LEFT JOIN product_variants pv ON pv.id = di.variant_id
      LEFT JOIN product_department_stock pds
        ON pds.product_id = p.id
        AND pds.department_id = ?
        AND IFNULL(pds.variant_id, '') = IFNULL(di.variant_id, '')
      WHERE di.document_id = ?
      ORDER BY COALESCE(di.sort_order, 0) ASC, di.id ASC
    `;
    itemsParams = [stockDepartmentId, id];
  } else {
    itemsSql = `
      SELECT di.*, p.name as product_name, p.sku, p.unit, pv.name as variant_name,
             COALESCE((
               SELECT SUM(pds2.stock)
               FROM product_department_stock pds2
               JOIN departments dep ON dep.id = pds2.department_id AND dep.branch_id = ?
               WHERE pds2.product_id = p.id
             ), COALESCE(pbs.stock, 0)) as stock,
             di.quantity as quantity, di.price as price, di.amount as amount,
             di.net_weight as net_weight, di.book_qty as book_qty, di.unit_cost as unit_cost
      FROM document_items di
      JOIN products p ON p.id = di.product_id
      LEFT JOIN product_variants pv ON pv.id = di.variant_id
      LEFT JOIN product_branch_stock pbs ON pbs.product_id = p.id AND pbs.branch_id = ?
      WHERE di.document_id = ?
      ORDER BY COALESCE(di.sort_order, 0) ASC, di.id ASC
    `;
    itemsParams = [stockBranch, stockBranch, id];
  }
  const items = queryAll(itemsSql, itemsParams).map((row) => ({
    ...row,
    item_role: row.item_role || 'input',
    variant_name: row.variant_name || null,
  }));

  const input_items = items.filter((i) => i.item_role === 'input');
  const output_items = items.filter((i) => i.item_role === 'output');
  const sale_items = items.filter((i) => i.item_role === 'sale');
  const consumption_items = items.filter((i) => i.item_role === 'consumption');

  const extra_costs = doc.type === 'prihod' ? loadDocumentExtraCosts(id) : [];
  const extra_costs_total = extraCostsTotal(extra_costs);
  const capitalized_extra_total = capitalizedExtraTotal(extra_costs);
  const goods_total = Number(doc.total_amount) || 0;
  const remainder_document = doc.type === 'inventory' && doc.inventory_coverage !== 'remainder'
    ? loadRemainderSummary(id)
    : null;
  const inventoryAmounts = doc.type === 'inventory'
    ? inventoryStockAmountFields({ ...doc, remainder_document }, items, { includeWriteoffItems: true })
    : null;
  const inventoryItems = inventoryAmounts?.items || items;
  const inventoryTotalsOut = doc.type === 'inventory' ? inventoryTotals(inventoryItems) : null;

  let ai_pending_items = [];
  if (doc.ai_pending_json) {
    try {
      const parsed = JSON.parse(doc.ai_pending_json);
      ai_pending_items = Array.isArray(parsed) ? parsed : [];
    } catch {
      ai_pending_items = [];
    }
  }

  return {
    ...doc,
    ai_recognized: !!doc.ai_recognized,
    ai_unconfirmed_count: Number(doc.ai_unconfirmed_count) || 0,
    ai_pending_items,
    attachments: listDocumentAttachments(id),
    ...telegramSourceForDocument(id),
    shortage_total: inventoryTotalsOut?.shortage ?? 0,
    surplus_total: inventoryTotalsOut?.surplus ?? 0,
    remainder_document,
    items: doc.type === 'dish_sale' ? sale_items : inventoryItems,
    input_items,
    output_items,
    sale_items,
    consumption_items,
    extra_costs,
    extra_costs_total,
    capitalized_extra_total,
    landed_total: goods_total + capitalized_extra_total,
    ...(inventoryAmounts ? {
      counted_amount: inventoryAmounts.counted_amount,
      remainder_amount: inventoryAmounts.remainder_amount,
      remainder_items: inventoryAmounts.remainder_items,
      stock_amount: inventoryAmounts.stock_amount,
    } : {}),
  };
}

function validatePrihodItems(counterpartyId, items, branchId = DEFAULT_BRANCH_ID) {
  if (!counterpartyId || !items?.length) return;

  assertCounterpartyBranch(counterpartyId, branchId, 'prihod');

  for (const item of items) {
    if (!item.product_id) continue;
    const link = queryOne(
      'SELECT id FROM product_suppliers WHERE product_id = ? AND supplier_id = ? AND branch_id = ?',
      [item.product_id, counterpartyId, branchId],
    );
    if (!link) {
      const product = queryOne('SELECT name FROM products WHERE id = ?', [item.product_id]);
      throw new Error(`Товар «${product?.name || 'неизвестный'}» не привязан к выбранному поставщику в этом филиале`);
    }
  }
}

function itemsTotal(items) {
  return items.reduce((s, i) => s + itemLineAmount(i), 0);
}

function mapExtraCostRow(row) {
  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount) || 0,
    capitalize: Number(row.capitalize) !== 0,
    sort_order: row.sort_order || 0,
  };
}

function loadDocumentExtraCosts(documentId) {
  return queryAll(
    'SELECT * FROM document_extra_costs WHERE document_id = ? ORDER BY COALESCE(sort_order, 0) ASC, id ASC',
    [documentId],
  ).map(mapExtraCostRow);
}

function replaceDocumentExtraCosts(documentId, extras) {
  run('DELETE FROM document_extra_costs WHERE document_id = ?', [documentId]);
  extras.forEach((row, idx) => {
    run(`
      INSERT INTO document_extra_costs (id, document_id, title, amount, capitalize, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [uuidv4(), documentId, row.title, row.amount, row.capitalize ? 1 : 0, row.sort_order ?? idx]);
  });
}

function extraCostsForWrite(data, docType, documentId = null) {
  if (docType !== 'prihod') {
    if (Array.isArray(data.extra_costs) && data.extra_costs.length > 0) {
      throw new Error('Доп. расходы можно указать только в приходе');
    }
    return { extras: [], replace: true };
  }
  if (data.extra_costs === undefined && documentId) {
    return { extras: loadDocumentExtraCosts(documentId), replace: false };
  }
  return { extras: normalizeExtraCosts(data.extra_costs, docType), replace: true };
}

function assertExtraCostsAllocatable(items, extras) {
  if (capitalizedExtraTotal(extras) > 0) {
    allocateExtraCosts(items, extras);
  }
}

function loadStoredInputItems(documentId) {
  return queryAll(`
    SELECT product_id, variant_id, quantity, price, amount, net_weight
    FROM document_items
    WHERE document_id = ? AND COALESCE(item_role, 'input') = 'input'
    ORDER BY COALESCE(sort_order, 0) ASC, id ASC
  `, [documentId]);
}

function normalizeItems(items) {
  const valid = (items || []).filter((i) => i.product_id);
  if (valid.length === 0) {
    throw new Error('Добавьте хотя бы один товар в документ');
  }
  return valid.map((item) => {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Количество должно быть положительным числом');
    }
    let price = Number(item.price ?? 0);
    let amount;
    const rawAmount = item.amount;
    const hasAmount = rawAmount !== undefined && rawAmount !== null && rawAmount !== '';
    if (hasAmount) {
      amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('Сумма не может быть отрицательной');
      }
      amount = roundMoney(amount);
      if (qty > 0) price = amount / qty;
    } else {
      if (!Number.isFinite(price) || price < 0) {
        throw new Error('Цена не может быть отрицательной');
      }
      amount = roundMoney(qty * price);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('Цена не может быть отрицательной');
    }
    let netWeight = null;
    if (item.net_weight !== undefined && item.net_weight !== null && item.net_weight !== '') {
      const net = Number(item.net_weight);
      if (!Number.isFinite(net) || net < 0) {
        throw new Error('Нетто не может быть отрицательным');
      }
      netWeight = net;
    }
    return { ...item, quantity: qty, price, amount, net_weight: netWeight };
  });
}

function assertValidDate(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date).slice(0, 10))) {
    throw new Error('Укажите корректную дату в формате ГГГГ-ММ-ДД');
  }
}

function insertDocumentItems(documentId, items, itemRole = 'input', sortOffset = 0) {
  items.forEach((item, idx) => {
    const toza = item.toza || 0;
    const qiymali = item.qiymali || 0;
    const otkhod = item.otkhod || 0;
    run(`
      INSERT INTO document_items (id, document_id, product_id, variant_id, quantity, price, amount, item_role, toza, qiymali, otkhod, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(),
      documentId,
      item.product_id,
      item.variant_id || null,
      item.quantity,
      item.price || 0,
      item.quantity * (item.price || 0),
      itemRole,
      toza,
      qiymali,
      otkhod,
      sortOffset + idx,
    ]);
  });
}

function insertDishSaleLines(documentId, items) {
  items.forEach((item, idx) => {
    run(`
      INSERT INTO document_items
        (id, document_id, product_id, variant_id, quantity, price, amount, item_role, unit_cost, cost_amount, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'sale', ?, ?, ?)
    `, [
      uuidv4(),
      documentId,
      item.product_id,
      item.variant_id || null,
      item.quantity,
      item.price || 0,
      item.quantity * (item.price || 0),
      item.unit_cost || 0,
      item.cost_amount || 0,
      idx,
    ]);
  });
}

function persistDishSaleDocument(id, data, userId, branchId, items, willConfirm) {
  assertActiveBranchOwnership(data.branch_id, branchId);
  const docBranchId = branchId;
  const fromDept = data.from_department_id;
  const total = items.reduce((s, i) => s + i.quantity * i.price, 0);
  const number = data.number || generateDocNumber(docBranchId, 'dish_sale');

  if (willConfirm) {
    buildDishSalePlan(items, fromDept, docBranchId);
  }

  transaction(() => {
    run(`
      INSERT INTO documents (id, number, type, counterparty_id, date, comment, from_location, to_location,
        branch_id, from_department_id, total_amount, status)
      VALUES (?, ?, 'dish_sale', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      number,
      data.counterparty_id || null,
      data.date,
      data.comment || '',
      data.from_location || '',
      data.to_location || '',
      docBranchId,
      fromDept,
      total,
      data.status || 'draft',
    ]);

    insertDishSaleLines(id, items);
    addHistory(id, 'created', userId);

    if (willConfirm) {
      applyDishSaleConsumption(id, fromDept, docBranchId);
      updateStock(id);
      addHistory(id, 'confirmed', userId);
    }
  });

  return getDocument(id, docBranchId);
}

function updateDishSaleDocument(id, existing, data, userId, branchId, items) {
  assertActiveBranchOwnership(data.branch_id, branchId);
  const docBranchId = branchId;
  const fromDept = data.from_department_id ?? existing.from_department_id ?? null;
  const wasConfirmed = existing.status === 'confirmed';
  const willConfirm = data.status === 'confirmed' || (wasConfirmed && data.status !== 'draft');
  const total = items.reduce((s, i) => s + i.quantity * i.price, 0);

  if (wasConfirmed) assertConfirmedDocCanReverse(existing, EDIT_CONFIRMED_ACTION);
  if (willConfirm && !wasConfirmed) {
    buildDishSalePlan(items, fromDept, docBranchId);
  }

  transaction(() => {
    if (wasConfirmed) updateStock(id, true);
    if (willConfirm && wasConfirmed) buildDishSalePlan(items, fromDept, docBranchId);

    run(`
      UPDATE documents
      SET counterparty_id=?, date=?, comment=?, from_location=?, to_location=?,
          branch_id=?, from_department_id=?, total_amount=?, status=?, updated_at=datetime('now')
      WHERE id=?
    `, [
      data.counterparty_id ?? existing.counterparty_id ?? null,
      data.date ?? existing.date,
      data.comment ?? existing.comment ?? '',
      data.from_location ?? existing.from_location ?? '',
      data.to_location ?? existing.to_location ?? '',
      docBranchId,
      fromDept,
      total,
      willConfirm ? 'confirmed' : (data.status || existing.status),
      id,
    ]);

    run('DELETE FROM document_items WHERE document_id = ?', [id]);
    insertDishSaleLines(id, items);
    addHistory(id, 'updated', userId);

    if (willConfirm) {
      applyDishSaleConsumption(id, fromDept, docBranchId);
      updateStock(id);
      if (!wasConfirmed) addHistory(id, 'confirmed', userId);
    }
  });

  return getDocument(id, docBranchId);
}

function persistInventoryDocument(existingId, data, userId, branchId, existing = null) {
  assertActiveBranchOwnership(data.branch_id, branchId);
  const docBranchId = branchId;
  const toDepartmentId = data.to_department_id ?? existing?.to_department_id ?? null;
  if (!toDepartmentId) throw new Error('Выберите отдел для инвентаризации');
  assertDepartmentInBranch(toDepartmentId, docBranchId);
  if (existing?.inventory_coverage === 'remainder') {
    throw new Error('Документ списания непересчитанного нельзя редактировать');
  }

  let items = normalizeInventoryItems(data.items);
  let id = existingId || uuidv4();
  if (!existing) {
    const openDraft = findOpenInventoryDraft(toDepartmentId, docBranchId);
    if (openDraft) {
      id = openDraft.id;
      existing = openDraft;
      existingId = openDraft.id;
      const stored = queryAll(
        `SELECT * FROM document_items
         WHERE document_id = ?
         ORDER BY COALESCE(sort_order, 0) ASC, id ASC`,
        [id],
      ).map(inventoryItemFromStoredRow);
      items = mergeNormalizedInventoryItems(stored, items);
    }
  }
  const number = data.number || existing?.number || generateDocNumber(docBranchId, 'inventory');
  const wasConfirmed = existing?.status === 'confirmed';
  const willConfirm = data.status === 'confirmed' || (wasConfirmed && data.status !== 'draft');
  const status = willConfirm ? 'confirmed' : (data.status || existing?.status || 'draft');
  const coverage = normalizeInventoryCoverage(data.inventory_coverage, existing);
  const liable = normalizeInventoryLiable(data, docBranchId, existing);
  const articleId = data.article_id !== undefined
    ? (data.article_id || null)
    : (existing?.article_id || null);
  if (articleId && (willConfirm || coverage === 'full')) {
    assertExpenseArticle(articleId, docBranchId);
  }

  assertNoOpenInventoryDraft(toDepartmentId, docBranchId, existingId);

  transaction(() => {
    if (existing && wasConfirmed) {
      assertConfirmedDocCanReverse(existing, EDIT_CONFIRMED_ACTION);
      reverseInventoryRemainder(id, userId);
      updateStock(id, true);
    }

    if (willConfirm) {
      items = applyInventoryBookSnapshot(toDepartmentId, items);
      validateInventoryShortage(toDepartmentId, items);
    }

    const totals = inventoryTotals(items);

    if (existing) {
      run(`
        UPDATE documents
        SET date=?, comment=?, branch_id=?, to_department_id=?,
            total_amount=?, status=?,
            inventory_coverage=?, article_id=?, liable_user_id=?, liable_department_id=?,
            updated_at=datetime('now')
        WHERE id=?
      `, [
        data.date ?? existing.date,
        data.comment ?? existing.comment ?? '',
        docBranchId,
        toDepartmentId,
        totals.net,
        status,
        coverage,
        articleId,
        liable.liable_user_id,
        liable.liable_department_id,
        id,
      ]);
      run('DELETE FROM document_items WHERE document_id = ?', [id]);
    } else {
      run(`
        INSERT INTO documents (
          id, number, type, counterparty_id, date, comment, from_location, to_location,
          branch_id, from_branch_id, to_branch_id, from_department_id, to_department_id,
          total_amount, status, inventory_coverage, article_id, liable_user_id, liable_department_id
        )
        VALUES (?, ?, 'inventory', NULL, ?, ?, '', '', ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, number, data.date, data.comment || '',
        docBranchId, toDepartmentId, totals.net, status,
        coverage, articleId, liable.liable_user_id, liable.liable_department_id,
      ]);
    }

    persistInventoryItems(id, items);
    addHistory(id, existing ? 'updated' : 'created', userId);

    if (willConfirm) {
      updateStock(id);
      if (!wasConfirmed) addHistory(id, 'confirmed', userId);
      const parent = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
      createInventoryRemainderWriteoff(parent, items, userId);
    }
  });

  return getDocument(id, docBranchId);
}

export function createDocument(data, userId = null, branchId = DEFAULT_BRANCH_ID) {
  assertValidDate(data.date);
  if (data.type === 'dish_sale') {
    const items = normalizeItems(data.items);
    assertActiveBranchOwnership(data.branch_id, branchId);
    const docBranchId = branchId;
    const fromDept = data.from_department_id || null;
    if (!fromDept) throw new Error('Выберите склад списания ингредиентов');
    assertDepartmentInBranch(fromDept, docBranchId);
    if (data.counterparty_id) {
      assertCounterpartyBranch(data.counterparty_id, docBranchId, 'rashod');
    }
    const willConfirm = data.status === 'confirmed';
    return persistDishSaleDocument(uuidv4(), data, userId, branchId, items, willConfirm);
  }

  if (data.type === 'razdelka') {
    const { inputItems } = normalizeRazdelkaItems(data);
    const calculationId = data.calculation_id || null;
    assertActiveBranchOwnership(data.branch_id, branchId);
    const docBranchId = branchId;
    const fromDept = data.from_department_id || null;
    const toDept = data.to_department_id || null;
    const outputItems = buildRazdelkaOutputItemsFromInput(inputItems, calculationId, docBranchId);
    const enrichedInputs = enrichRazdelkaItemPrices(inputItems, fromDept, docBranchId);
    const enrichedOutputs = prepareRazdelkaOutputs(inputItems, outputItems, fromDept, docBranchId);

    validateRazdelka(docBranchId, fromDept, toDept, enrichedInputs, false, [], true);

    const id = uuidv4();
    const number = data.number || generateDocNumber(docBranchId, 'razdelka');
    const total = calcRazdelkaTotal(enrichedOutputs);
    const willConfirm = data.status === 'confirmed';

    if (willConfirm) {
      validateRazdelka(docBranchId, fromDept, toDept, enrichedInputs, false, [], true);
    }

    transaction(() => {
      run(`
        INSERT INTO documents (id, number, type, counterparty_id, date, comment, from_location, to_location,
          branch_id, from_branch_id, to_branch_id, from_department_id, to_department_id, total_amount, status, calculation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, number, 'razdelka', null,
        data.date, data.comment || '', '', '',
        docBranchId, null, null, fromDept, toDept,
        total, data.status || 'draft', calculationId,
      ]);

      insertDocumentItems(id, enrichedInputs, 'input');
      insertDocumentItems(id, enrichedOutputs, 'output', enrichedInputs.length);
      addHistory(id, 'created', userId);

      if (willConfirm) {
        updateStock(id);
        addHistory(id, 'confirmed', userId);
      }
    });

    return getDocument(id, docBranchId);
  }

  if (data.type === 'inventory') {
    return persistInventoryDocument(null, data, userId, branchId);
  }

  let items = normalizeItems(data.items);

  let docBranchId;
  let fromBranchId = null;
  let toBranchId = null;
  if (data.type === 'peremeshchenie') {
    ({ docBranchId, fromBranchId, toBranchId } = resolveTransferBranchIds(data, branchId));
  } else {
    assertActiveBranchOwnership(data.branch_id, branchId);
    docBranchId = branchId;
  }
  const fromDepartmentId = data.type === 'peremeshchenie' ? (data.from_department_id || null) : null;
  let toDepartmentId = data.type === 'peremeshchenie' ? (data.to_department_id || null) : null;
  let rashodFromDepartmentId = null;

  if (data.type === 'prihod') {
    toDepartmentId = data.to_department_id || null;
    if (!toDepartmentId) throw new Error('Выберите отдел для прихода');
    assertDepartmentInBranch(toDepartmentId, docBranchId);
  }
  if (data.type === 'return_customer') {
    toDepartmentId = data.to_department_id || null;
    if (!toDepartmentId) throw new Error('Выберите отдел для возврата');
    assertDepartmentInBranch(toDepartmentId, docBranchId);
    if (!data.counterparty_id) throw new Error('Выберите клиента для возврата');
  }
  if (data.type === 'return_supplier' && !data.counterparty_id) {
    throw new Error('Выберите поставщика для возврата');
  }
  const sourceDocumentId = (data.type === 'return_supplier' || data.type === 'return_customer')
    ? (data.source_document_id || null)
    : null;
  if (data.type === 'return_supplier') {
    assertReturnSupplierSourceDocument(sourceDocumentId, docBranchId, data.counterparty_id, data.date);
    items = inheritReturnSupplierNet(items, sourceDocumentId);
  }
  if (data.type === 'return_customer') {
    assertReturnCustomerSourceDocument(sourceDocumentId, docBranchId, data.counterparty_id, data.date);
  }

  if (isOutgoingDocType(data.type)) {
    rashodFromDepartmentId = data.from_department_id || null;
    if (!rashodFromDepartmentId) throw new Error('Выберите отдел для расхода/возврата');
    assertDepartmentInBranch(rashodFromDepartmentId, docBranchId);
  }

  if (data.type !== 'peremeshchenie' && data.counterparty_id) {
    assertCounterpartyBranch(data.counterparty_id, docBranchId, data.type);
  }

  if (data.type === 'prihod' && data.counterparty_id) {
    validatePrihodItems(data.counterparty_id, items, docBranchId);
  }

  if (data.type === 'peremeshchenie') {
    if (fromDepartmentId) assertDepartmentInBranch(fromDepartmentId, fromBranchId);
    if (toDepartmentId) assertDepartmentInBranch(toDepartmentId, toBranchId || fromBranchId);
    validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items, false, false);
  }

  const id = uuidv4();
  const number = data.number || generateDocNumber(docBranchId, data.type);
  const willConfirmReturn = data.status === 'confirmed'
    && (data.type === 'return_supplier' || data.type === 'return_customer');
  if (willConfirmReturn && sourceDocumentId) {
    assertReturnQtyNotExceeded(sourceDocumentId, null, items);
  }
  const total = itemsTotal(items);
  const { extras, replace: replaceExtras } = extraCostsForWrite(data, data.type);
  assertExtraCostsAllocatable(items, extras);
  const willConfirm = data.status === 'confirmed';
  const contractId = isSupplierCounterpartyDoc(data.type)
    ? resolveDocumentContractId(data.contract_id, data.counterparty_id, docBranchId)
    : null;

  if (willConfirm) {
    if (isOutgoingDocType(data.type)) validateRashodStock(docBranchId, rashodFromDepartmentId, items);
    if (data.type === 'peremeshchenie') {
      validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items);
    }
  }

  const aiRecognized = data.type === 'prihod' && (data.ai_recognized === true || data.ai_recognized === 1) ? 1 : 0;
  const aiPendingJson = aiRecognized && Array.isArray(data.ai_pending_items)
    ? JSON.stringify(data.ai_pending_items)
    : null;
  const aiUnconfirmedFromItems = aiRecognized
    ? items.filter((i) => i.ai_confirmed === false || i.ai_confirmed === 0).length
    : 0;
  const aiUnconfirmedCount = aiRecognized
    ? aiUnconfirmedFromItems + (Array.isArray(data.ai_pending_items) ? data.ai_pending_items.length : 0)
    : 0;

  transaction(() => {
    run(`
      INSERT INTO documents (id, number, type, counterparty_id, contract_id, date, comment, from_location, to_location,
        branch_id, from_branch_id, to_branch_id, from_department_id, to_department_id, source_document_id, total_amount, status,
        ai_recognized, ai_pending_json, ai_unconfirmed_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, number, data.type, data.counterparty_id || null, contractId,
      data.date, data.comment || '', data.from_location || '', data.to_location || '',
      docBranchId, fromBranchId, toBranchId,
      isOutgoingDocType(data.type) ? rashodFromDepartmentId : fromDepartmentId,
      toDepartmentId,
      sourceDocumentId,
      total, data.status || 'draft',
      aiRecognized, aiPendingJson, aiUnconfirmedCount,
    ]);

    items.forEach((item, idx) => {
      const aiConfirmed = aiRecognized
        ? (item.ai_confirmed === false || item.ai_confirmed === 0 ? 0 : 1)
        : 1;
      run(`
        INSERT INTO document_items (id, document_id, product_id, variant_id, quantity, price, amount, item_role, net_weight, sort_order, ai_confirmed, ai_raw_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'input', ?, ?, ?, ?)
      `, [
        uuidv4(), id, item.product_id, item.variant_id || null, item.quantity, item.price, item.amount,
        item.net_weight ?? null, idx, aiConfirmed, item.ai_raw_name || null,
      ]);
    });

    if (replaceExtras) replaceDocumentExtraCosts(id, extras);

    addHistory(id, 'created', userId);

    if (willConfirm) {
      if (data.type === 'return_customer') applyReturnCustomerLineCosts(id);
      updateStock(id);
      addHistory(id, 'confirmed', userId);
    }
  });

  return getDocument(id, docBranchId);
}

export function updateDocument(id, data, userId = null, branchId = DEFAULT_BRANCH_ID) {
  const existingDoc = queryOne(
    `SELECT * FROM documents WHERE id = ?
      AND (branch_id = ? OR from_branch_id = ? OR to_branch_id = ?)`,
    [id, branchId, branchId, branchId],
  );
  if (!existingDoc) throw new Error('Документ не найден');
  if (existingDoc.status === 'cancelled') throw new Error('Отменённый документ нельзя редактировать');
  if (data.date !== undefined) assertValidDate(data.date);

  const docType = data.type || existingDoc.type;

  if (docType === 'dish_sale') {
    const items = normalizeItems(data.items);
    assertActiveBranchOwnership(data.branch_id, branchId);
    const fromDept = data.from_department_id ?? existingDoc.from_department_id ?? null;
    if (!fromDept) throw new Error('Выберите склад списания ингредиентов');
    assertDepartmentInBranch(fromDept, branchId);
    const counterpartyId = data.counterparty_id ?? existingDoc.counterparty_id;
    if (counterpartyId) {
      assertCounterpartyBranch(counterpartyId, branchId, 'rashod');
    }
    return updateDishSaleDocument(id, existingDoc, data, userId, branchId, items);
  }

  if (docType === 'razdelka') {
    const { inputItems } = normalizeRazdelkaItems(data);
    const calculationId = data.calculation_id ?? existingDoc.calculation_id ?? null;
    assertActiveBranchOwnership(data.branch_id, branchId);
    const docBranchId = branchId;
    const fromDept = data.from_department_id ?? existingDoc.from_department_id ?? null;
    const toDept = data.to_department_id ?? existingDoc.to_department_id ?? null;
    const outputItems = buildRazdelkaOutputItemsFromInput(inputItems, calculationId, docBranchId);
    const enrichedInputs = enrichRazdelkaItemPrices(inputItems, fromDept, docBranchId);
    const enrichedOutputs = prepareRazdelkaOutputs(inputItems, outputItems, fromDept, docBranchId);
    const wasConfirmed = existingDoc.status === 'confirmed';
    const willConfirm = data.status === 'confirmed' || (wasConfirmed && data.status !== 'draft');

    validateRazdelka(docBranchId, fromDept, toDept, enrichedInputs, false, [], true);

    transaction(() => {
      if (wasConfirmed) {
        assertConfirmedDocCanReverse(existingDoc, EDIT_CONFIRMED_ACTION);
        updateStock(id, true);
      }

      if (willConfirm && !wasConfirmed) {
        validateRazdelka(docBranchId, fromDept, toDept, enrichedInputs, false, [], true);
      }

      const total = calcRazdelkaTotal(enrichedOutputs);

      run(`
        UPDATE documents
        SET date=?, comment=?, branch_id=?, from_department_id=?, to_department_id=?,
            total_amount=?, status=?, calculation_id=?, updated_at=datetime('now')
        WHERE id=?
      `, [
        data.date || existingDoc.date,
        data.comment !== undefined ? (data.comment || '') : (existingDoc.comment || ''),
        docBranchId,
        fromDept,
        toDept,
        total,
        data.status || existingDoc.status,
        calculationId,
        id,
      ]);

      run('DELETE FROM document_items WHERE document_id = ?', [id]);
      insertDocumentItems(id, enrichedInputs, 'input');
      insertDocumentItems(id, enrichedOutputs, 'output', enrichedInputs.length);
      addHistory(id, 'updated', userId);

      if (willConfirm) {
        if (docType === 'return_customer') applyReturnCustomerLineCosts(id);
        updateStock(id);
        if (!wasConfirmed) addHistory(id, 'confirmed', userId);
      }
    });

    return getDocument(id, docBranchId);
  }

  if (docType === 'inventory') {
    return persistInventoryDocument(id, data, userId, branchId, existingDoc);
  }

  const counterpartyId = data.counterparty_id !== undefined ? (data.counterparty_id || null) : existingDoc.counterparty_id;
  let items = normalizeItems(data.items !== undefined ? data.items : loadStoredInputItems(id));

  let docBranchId;
  let fromBranchId = null;
  let toBranchId = null;
  if (docType === 'peremeshchenie') {
    ({ docBranchId, fromBranchId, toBranchId } = resolveTransferBranchIds(data, branchId, existingDoc));
  } else {
    assertActiveBranchOwnership(data.branch_id, branchId);
    docBranchId = branchId;
  }
  const fromDepartmentId = docType === 'peremeshchenie'
    ? (data.from_department_id ?? existingDoc.from_department_id ?? null)
    : null;
  let toDepartmentId = docType === 'peremeshchenie'
    ? (data.to_department_id ?? existingDoc.to_department_id ?? null)
    : null;
  let rashodFromDepartmentId = null;

  if (docType === 'prihod') {
    toDepartmentId = data.to_department_id ?? existingDoc.to_department_id ?? null;
    if (!toDepartmentId) throw new Error('Выберите отдел для прихода');
    assertDepartmentInBranch(toDepartmentId, docBranchId);
  }
  if (docType === 'return_customer') {
    toDepartmentId = data.to_department_id ?? existingDoc.to_department_id ?? null;
    if (!toDepartmentId) throw new Error('Выберите отдел для возврата');
    assertDepartmentInBranch(toDepartmentId, docBranchId);
    if (!counterpartyId) throw new Error('Выберите клиента для возврата');
  }
  if (docType === 'return_supplier' && !counterpartyId) {
    throw new Error('Выберите поставщика для возврата');
  }
  const sourceDocumentId = (docType === 'return_supplier' || docType === 'return_customer')
    ? (data.source_document_id ?? existingDoc.source_document_id ?? null)
    : null;
  const returnDate = data.date || existingDoc.date;
  if (docType === 'return_supplier') {
    assertReturnSupplierSourceDocument(sourceDocumentId, docBranchId, counterpartyId, returnDate);
    items = inheritReturnSupplierNet(items, sourceDocumentId);
  }
  if (docType === 'return_customer') {
    assertReturnCustomerSourceDocument(sourceDocumentId, docBranchId, counterpartyId, returnDate);
  }

  if (isOutgoingDocType(docType)) {
    rashodFromDepartmentId = data.from_department_id ?? existingDoc.from_department_id ?? null;
    if (!rashodFromDepartmentId) throw new Error('Выберите отдел для расхода/возврата');
    assertDepartmentInBranch(rashodFromDepartmentId, docBranchId);
  }

  if (docType !== 'peremeshchenie' && counterpartyId) {
    assertCounterpartyBranch(counterpartyId, docBranchId, docType);
  }

  if (docType === 'prihod' && counterpartyId) {
    validatePrihodItems(counterpartyId, items, docBranchId);
  }

  if (docType === 'peremeshchenie') {
    if (fromDepartmentId) assertDepartmentInBranch(fromDepartmentId, fromBranchId);
    if (toDepartmentId) assertDepartmentInBranch(toDepartmentId, toBranchId || fromBranchId);
    validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items, false, false);
  }

  const wasConfirmed = existingDoc.status === 'confirmed';
  const willConfirm = data.status === 'confirmed' || (wasConfirmed && data.status !== 'draft');
  const { extras, replace: replaceExtras } = extraCostsForWrite(data, docType, id);
  assertExtraCostsAllocatable(items, extras);

  if (wasConfirmed) assertConfirmedDocCanReverse(existingDoc, EDIT_CONFIRMED_ACTION);

  transaction(() => {
    if (wasConfirmed) updateStock(id, true);

    if (willConfirm) {
      if (isOutgoingDocType(docType)) validateRashodStock(docBranchId, rashodFromDepartmentId, items);
      if (docType === 'peremeshchenie') {
        validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items);
      }
    }

    const total = itemsTotal(items);
    const savedFromDepartmentId = isOutgoingDocType(docType) ? rashodFromDepartmentId : fromDepartmentId;
    const contractId = isSupplierCounterpartyDoc(docType)
      ? resolveDocumentContractId(
        data.contract_id ?? (existingDoc.contract_id || DEFAULT_CONTRACT_ID),
        counterpartyId,
        docBranchId,
      )
      : null;

    // Сохранение прихода с ИИ = пользователь проверил позиции; снимаем «неподтверждено» с строк.
    // Несопоставленные (ai_pending) можно передать с клиента или оставить как были.
    const isAiDoc = !!existingDoc.ai_recognized;
    let aiPendingJson = existingDoc.ai_pending_json || null;
    if (isAiDoc && data.ai_pending_items !== undefined) {
      aiPendingJson = Array.isArray(data.ai_pending_items) && data.ai_pending_items.length
        ? JSON.stringify(data.ai_pending_items)
        : null;
    }
    let aiPendingLen = 0;
    if (aiPendingJson) {
      try {
        const p = JSON.parse(aiPendingJson);
        aiPendingLen = Array.isArray(p) ? p.length : 0;
      } catch { /* */ }
    }
    // После ручного сохранения строки считаем подтверждёнными (пользователь видел документ).
    const aiUnconfirmedCount = isAiDoc ? aiPendingLen : (Number(existingDoc.ai_unconfirmed_count) || 0);

    run(`
      UPDATE documents
      SET counterparty_id=?, contract_id=?, date=?, comment=?, from_location=?, to_location=?,
          branch_id=?, from_branch_id=?, to_branch_id=?, from_department_id=?, to_department_id=?, source_document_id=?,
          total_amount=?, status=?,
          ai_pending_json=?, ai_unconfirmed_count=?,
          updated_at=datetime('now')
      WHERE id=?
    `, [
      counterpartyId, contractId, returnDate,
      data.comment !== undefined ? (data.comment || '') : (existingDoc.comment || ''),
      data.from_location !== undefined ? (data.from_location || '') : (existingDoc.from_location || ''),
      data.to_location !== undefined ? (data.to_location || '') : (existingDoc.to_location || ''),
      docBranchId, fromBranchId, toBranchId, savedFromDepartmentId, toDepartmentId, sourceDocumentId,
      total, data.status || existingDoc.status,
      isAiDoc ? aiPendingJson : existingDoc.ai_pending_json,
      isAiDoc ? aiUnconfirmedCount : (Number(existingDoc.ai_unconfirmed_count) || 0),
      id,
    ]);

    run('DELETE FROM document_items WHERE document_id = ?', [id]);

    items.forEach((item, idx) => {
      run(`
        INSERT INTO document_items (id, document_id, product_id, variant_id, quantity, price, amount, item_role, net_weight, sort_order, ai_confirmed, ai_raw_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'input', ?, ?, ?, ?)
      `, [
        uuidv4(), id, item.product_id, item.variant_id || null, item.quantity, item.price, item.amount,
        item.net_weight ?? null, idx,
        isAiDoc ? 1 : 1,
        item.ai_raw_name || null,
      ]);
    });

    if (replaceExtras) replaceDocumentExtraCosts(id, extras);

    addHistory(id, 'updated', userId);

    if (willConfirm) {
      if (docType === 'return_customer') applyReturnCustomerLineCosts(id);
      updateStock(id);
      if (!wasConfirmed) addHistory(id, 'confirmed', userId);
    }
  });

  return getDocument(id, docBranchId);
}

export function confirmDocument(id, userId = null) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw new Error('Документ не найден');
  if (doc.status === 'confirmed') return getDocument(id, doc.branch_id);
  if (doc.status === 'cancelled') throw new Error('Документ отменён');
  if (doc.ai_recognized && Number(doc.ai_unconfirmed_count) > 0) {
    throw new Error('Сначала подтвердите позиции, распознанные ИИ (сохраните документ после проверки)');
  }

  const items = queryAll('SELECT * FROM document_items WHERE document_id = ?', [id]);
  if (isOutgoingDocType(doc.type)) validateRashodStock(doc.branch_id || DEFAULT_BRANCH_ID, doc.from_department_id, items);
  if (doc.type === 'razdelka') {
    const inputItems = items.filter((i) => (i.item_role || 'input') === 'input');
    validateRazdelka(
      doc.branch_id || DEFAULT_BRANCH_ID,
      doc.from_department_id,
      doc.to_department_id,
      inputItems,
      false,
      [],
      true,
    );
  }
  if (doc.type === 'peremeshchenie') {
    validatePeremeshchenie(
      doc.from_branch_id || doc.branch_id,
      doc.to_branch_id || doc.from_branch_id || doc.branch_id,
      doc.from_department_id,
      doc.to_department_id,
      items,
    );
  }
  if (doc.type === 'return_supplier') {
    assertReturnSupplierSourceDocument(
      doc.source_document_id,
      doc.branch_id || DEFAULT_BRANCH_ID,
      doc.counterparty_id,
      doc.date,
    );
    assertReturnQtyNotExceeded(doc.source_document_id, id, items);
  }
  if (doc.type === 'return_customer') {
    assertReturnCustomerSourceDocument(
      doc.source_document_id,
      doc.branch_id || DEFAULT_BRANCH_ID,
      doc.counterparty_id,
      doc.date,
    );
    assertReturnQtyNotExceeded(doc.source_document_id, id, items);
  }
  transaction(() => {
    if (doc.type === 'inventory') {
      if (doc.inventory_coverage === 'remainder') {
        throw new Error('Документ списания непересчитанного нельзя проводить отдельно');
      }
      const snapped = applyInventoryBookSnapshot(doc.to_department_id, items);
      writeInventoryBookSnapshot(snapped);
      validateInventoryShortage(doc.to_department_id, snapped);
    }
    if (doc.type === 'return_customer') {
      applyReturnCustomerLineCosts(id);
    }
    if (doc.type === 'dish_sale') {
      applyDishSaleConsumption(id, doc.from_department_id, doc.branch_id || DEFAULT_BRANCH_ID);
    }
    run(`UPDATE documents SET status='confirmed', updated_at=datetime('now') WHERE id=?`, [id]);
    updateStock(id);
    addHistory(id, 'confirmed', userId);
    if (doc.type === 'inventory') {
      const parent = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
      const snappedItems = queryAll('SELECT * FROM document_items WHERE document_id = ?', [id]);
      createInventoryRemainderWriteoff(parent, snappedItems, userId);
    }
  });

  return getDocument(id, doc.branch_id);
}

function assertRazdelkaCanReverse(documentId, doc) {
  if (doc.type !== 'razdelka') return;
  const items = queryAll('SELECT * FROM document_items WHERE document_id = ?', [documentId]);
  const outputItems = items.filter((i) => i.item_role === 'output');
  validateRazdelka(
    doc.branch_id || DEFAULT_BRANCH_ID,
    doc.from_department_id,
    doc.to_department_id,
    [],
    true,
    outputItems,
  );
}

function assertTransferCanReverse(doc, items) {
  if (doc.type !== 'peremeshchenie') return;
  const fromId = doc.from_branch_id || doc.branch_id;
  const toId = doc.to_branch_id || fromId;
  const fromDept = doc.from_department_id || null;
  const toDept = doc.to_department_id || null;

  if (fromDept || toDept) {
    // Department-level: check that target dept has enough stock to reverse
    const effectiveToDept = toDept || getDefaultDepartmentId(fromId || DEFAULT_BRANCH_ID);
    if (effectiveToDept) {
      for (const item of items) {
        const stock = getDepartmentStock(item.product_id, effectiveToDept, item.variant_id || null);
        if (stock + 1e-9 < itemStockQty(item)) {
          const label = getItemStockLabel(item);
          throw new Error(
            `Нельзя отменить перемещение: недостаточно «${label}» в отделе-получателе для возврата (есть ${stock})`,
          );
        }
      }
    }
    return;
  }

  // Branch-level: check that receiving branch has enough stock
  if (toId && toId !== fromId) {
    for (const item of items) {
      const stock = item.variant_id
        ? getVariantBranchStock(item.variant_id, toId)
        : getBranchStock(item.product_id, toId);
      if (stock + 1e-9 < itemStockQty(item)) {
        const label = getItemStockLabel(item);
        throw new Error(
          `Нельзя отменить перемещение: недостаточно «${label}» в филиале-получателе для возврата (есть ${stock})`,
        );
      }
    }
  }
}

function isInventoryParentDoc(doc) {
  return doc?.type === 'inventory' && doc.inventory_coverage !== 'remainder';
}

/** Все проверки перед откатом остатков проведённого документа (отмена / удаление / правка). */
function assertConfirmedDocCanReverse(doc, action = 'отменить') {
  if (doc?.status !== 'confirmed') return;
  assertRazdelkaCanReverse(doc.id, doc);
  const items = queryAll('SELECT * FROM document_items WHERE document_id = ?', [doc.id]);
  assertTransferCanReverse(doc, items);
  const remainder = isInventoryParentDoc(doc) ? findInventoryRemainder(doc.id) : null;
  if (remainder?.status === 'confirmed') {
    assertNoLaterStockMovements(remainder, null, [], action);
    assertNoLaterStockMovements(doc, null, [remainder.id], action);
  } else {
    assertNoLaterStockMovements(doc, null, [], action);
  }
}

function assertNoLinkedConfirmedReturns(id) {
  const linked = queryOne(`
    SELECT number, type FROM documents
    WHERE source_document_id = ? AND status = 'confirmed'
      AND type IN ('return_supplier', 'return_customer')
    LIMIT 1
  `, [id]);
  if (linked) {
    const label = linked.type === 'return_supplier' ? 'возврат поставщику' : 'возврат от клиента';
    throw new Error(`Нельзя отменить: по документу проведён ${label} №${linked.number}. Сначала отмените возврат.`);
  }
}

function assertNoLinkedPayments(id, remainder, action) {
  if (remainder) {
    const remPayments = queryOne('SELECT COUNT(*) as c FROM payments WHERE document_id = ?', [remainder.id])?.c || 0;
    if (remPayments > 0) {
      throw new Error(`Нельзя ${action} документ: есть оплаты по списанию непересчитанного.`);
    }
  }
  const linkedPayments = queryOne('SELECT COUNT(*) as c FROM payments WHERE document_id = ?', [id])?.c || 0;
  if (linkedPayments > 0) {
    throw new Error(`Нельзя ${action} документ: есть привязанные оплаты. Сначала отвяжите или удалите оплаты.`);
  }
}

export function cancelDocument(id, userId = null) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw new Error('Документ не найден');

  const inventoryParent = isInventoryParentDoc(doc);
  const branchId = doc.branch_id || DEFAULT_BRANCH_ID;

  if (doc.status === 'cancelled') {
    if (!inventoryParent) return getDocument(id);
    assertNoOpenInventoryDraft(doc.to_department_id, branchId, id);
    transaction(() => {
      run(`UPDATE documents SET status='draft', updated_at=datetime('now') WHERE id=?`, [id]);
      addHistory(id, 'updated', userId);
    });
    return getDocument(id);
  }

  const remainder = inventoryParent ? findInventoryRemainder(id) : null;

  if (doc.status === 'confirmed') {
    if (doc.inventory_coverage === 'remainder') {
      throw new Error('Списание непересчитанного отменяется вместе с инвентаризацией — снимите проведение у неё');
    }
    assertNoLinkedConfirmedReturns(id);
    assertNoLinkedPayments(id, null, 'отменить');
    assertConfirmedDocCanReverse(doc);
  }

  if (inventoryParent) {
    assertNoOpenInventoryDraft(doc.to_department_id, branchId, id);
  }

  const nextStatus = inventoryParent ? 'draft' : 'cancelled';
  transaction(() => {
    if (remainder) reverseInventoryRemainder(id, userId);
    if (doc.status === 'confirmed') updateStock(id, true);
    run(`UPDATE documents SET status=?, updated_at=datetime('now') WHERE id=?`, [nextStatus, id]);
    addHistory(id, 'cancelled', userId);
  });

  return getDocument(id);
}

export function deleteDocument(id) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [id]);
  if (!doc) throw new Error('Документ не найден');
  if (doc.inventory_coverage === 'remainder' && doc.status === 'confirmed') {
    throw new Error('Сначала отмените списание непересчитанного');
  }
  const linkedReturns = queryOne(`
    SELECT COUNT(*) as c FROM documents
    WHERE source_document_id = ?
      AND NOT (type = 'inventory' AND inventory_coverage = 'remainder')
  `, [id])?.c || 0;
  if (linkedReturns > 0) {
    throw new Error('Нельзя удалить документ: к нему привязаны возвраты поставщику.');
  }
  const remainder = doc.type === 'inventory' ? findInventoryRemainder(id) : null;
  assertNoLinkedPayments(id, remainder, 'удалить');

  if (doc.status === 'confirmed') {
    assertConfirmedDocCanReverse(doc, 'удалить');
  }

  transaction(() => {
    if (remainder) {
      if (remainder.status === 'confirmed') updateStock(remainder.id, true);
      deleteAllDocumentAttachments(remainder.id);
      run('DELETE FROM documents WHERE id = ?', [remainder.id]);
    }
    if (doc.status === 'confirmed') {
      updateStock(id, true);
    }
    run('DELETE FROM telegram_messages WHERE document_id = ?', [id]);
    run(
      "UPDATE telegram_inbox SET status = 'new', document_id = NULL, updated_at = datetime('now') WHERE document_id = ?",
      [id],
    );
    deleteAllDocumentAttachments(id);
    run('DELETE FROM documents WHERE id = ?', [id]);
  });

  return { ok: true, number: doc.number };
}

function formatChangedBy(row) {
  if (row.changed_by_name) return row.changed_by_name;
  if (!row.changed_by || row.changed_by === 'user') return 'Не указан';
  if (row.changed_by === 'system') return 'Система';
  return row.changed_by;
}

export function getDocumentHistory(documentId) {
  const rows = queryAll(`
    SELECT h.id, h.document_id, h.action, h.snapshot, h.changed_by, h.created_at,
           u.name as changed_by_name
    FROM document_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.document_id = ?
  `, [documentId]).map((row) => ({
    ...row,
    user_name: formatChangedBy(row),
  }));
  return buildDocumentHistoryDiff(rows);
}
