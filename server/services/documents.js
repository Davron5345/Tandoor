import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { adjustBranchStock, getBranchStock, DEFAULT_BRANCH_ID } from '../branches.js';
import {
  assertDepartmentInBranch,
  getDefaultDepartmentId,
  getDepartmentStock,
  syncBranchStockFromDepartments,
} from '../departments.js';
import {
  getDepartmentAvgCost,
  getBranchAvgCost,
  getDepartmentStockWithCost,
  getVariantBranchStock,
  issueDepartmentStock,
  receiveDepartmentStock,
  reverseIssueDepartmentStock,
  reverseReceiveDepartmentStock,
  reverseTransferDepartmentStock,
  syncVariantCatalogStock,
  transferDepartmentStock,
} from '../inventoryCost.js';
import { getEffectiveProductPrice } from '../productBranches.js';
import { getCalculation, calcLineKey } from '../calculations.js';
import { applyDishSaleConsumption, buildDishSalePlan } from '../dishSales.js';
import {
  DEFAULT_CONTRACT_ID,
  isSupplierCounterpartyDoc,
  assertCounterpartyBranch,
} from './counterparties.js';
import { syncSupplierPriceListFromPrihod } from './supplierPrices.js';
import {
  allocateExtraCosts,
  extraCostsTotal,
  capitalizedExtraTotal,
  normalizeExtraCosts,
} from '../documentExtraCosts.js';
import { getStockReport } from './reports.js';
import { assertNoLaterStockMovements } from '../stockMovementGuard.js';
import { getCashArticle, getCashArticles } from '../cashArticles.js';
import { SHORTAGE_ARTICLE_CODE, cashArticleId } from '../cashArticleDefaults.js';

const { queryAll, queryOne, run, transaction } = db;

function generateDocNumber(branchId = DEFAULT_BRANCH_ID, docType) {
  if (!docType) throw new Error('Тип документа обязателен для номера');
  const rows = queryAll(`
    SELECT number FROM documents
    WHERE type = ?
      AND COALESCE(NULLIF(branch_id, ''), NULLIF(from_branch_id, ''), ?) = ?
  `, [docType, branchId, branchId]);
  let max = 0;
  for (const row of rows) {
    const n = parseInt(String(row.number).replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
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

function isOutgoingDocType(type) {
  return type === 'rashod' || type === 'return_supplier';
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

export function snapshotDocument(docId) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [docId]);
  const items = queryAll(`
    SELECT di.*, p.name as product_name, p.sku, p.unit
    FROM document_items di
    JOIN products p ON p.id = di.product_id
    WHERE di.document_id = ?
  `, [docId]);
  const extra_costs = queryAll(`
    SELECT * FROM document_extra_costs WHERE document_id = ? ORDER BY COALESCE(sort_order, 0) ASC, id ASC
  `, [docId]);
  const counterparty = doc?.counterparty_id
    ? queryOne('SELECT * FROM counterparties WHERE id = ?', [doc.counterparty_id])
    : null;
  return JSON.stringify({ document: doc, items, extra_costs, counterparty });
}

export function addHistory(documentId, action, userId = null) {
  run(`
    INSERT INTO document_history (id, document_id, action, snapshot, changed_by)
    VALUES (?, ?, ?, ?, ?)
  `, [uuidv4(), documentId, action, snapshotDocument(documentId), userId]);
}

function afterVariantStockChange(variantId, productId, branchId) {
  if (!variantId) return;
  syncVariantCatalogStock(variantId, branchId);
  syncBranchStockFromDepartments(branchId, productId);
}

function updateStock(documentId, reverse = false) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [documentId]);
  if (!doc || doc.status !== 'confirmed') return;

  const items = queryAll(
    'SELECT * FROM document_items WHERE document_id = ? ORDER BY COALESCE(sort_order, 0) ASC, id ASC',
    [documentId],
  );
  const extraCosts = queryAll(
    'SELECT * FROM document_extra_costs WHERE document_id = ? ORDER BY COALESCE(sort_order, 0) ASC, id ASC',
    [documentId],
  );
  const allocatedExtras = doc.type === 'prihod' ? allocateExtraCosts(items, extraCosts) : items.map(() => 0);
  const multiplier = reverse ? -1 : 1;
  const variantId = (item) => item.variant_id || null;

  if (doc.type === 'inventory') {
    applyInventoryStock(doc, items, reverse);
    return;
  }

  if (doc.type === 'razdelka') {
    const branchId = doc.branch_id || DEFAULT_BRANCH_ID;
    const fromDept = doc.from_department_id;
    const toDept = doc.to_department_id;
    const inputItems = items.filter((i) => (i.item_role || 'input') === 'input');
    const outputItems = items.filter((i) => i.item_role === 'output');

    for (const item of inputItems) {
      if (!reverse) {
        issueDepartmentStock(fromDept, item.product_id, item.quantity, variantId(item));
      } else {
        reverseIssueDepartmentStock(fromDept, item.product_id, item.quantity, item.price || 0, variantId(item));
      }
      afterVariantStockChange(variantId(item), item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    }
    for (const item of outputItems) {
      const unitCost = item.price || 0;
      if (!reverse) {
        receiveDepartmentStock(toDept, item.product_id, item.quantity, unitCost, variantId(item));
      } else {
        reverseReceiveDepartmentStock(toDept, item.product_id, item.quantity, unitCost, variantId(item));
      }
      afterVariantStockChange(variantId(item), item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    }
    return;
  }

  if (doc.type === 'dish_sale') {
    const branchId = doc.branch_id || DEFAULT_BRANCH_ID;
    const fromDept = doc.from_department_id;
    const consumptionItems = items.filter((i) => i.item_role === 'consumption');
    for (const item of consumptionItems) {
      const qty = Math.abs(item.quantity);
      if (qty <= 0) continue;
      if (!reverse) {
        issueDepartmentStock(fromDept, item.product_id, qty, variantId(item));
      } else {
        reverseIssueDepartmentStock(
          fromDept,
          item.product_id,
          qty,
          Number(item.unit_cost) || 0,
          variantId(item),
        );
      }
      afterVariantStockChange(variantId(item), item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    }
    return;
  }

  if (doc.type === 'peremeshchenie') {
    const fromId = doc.from_branch_id || doc.branch_id;
    const toId = doc.to_branch_id || fromId;
    const fromDept = doc.from_department_id || null;
    const toDept = doc.to_department_id || null;

    if (fromDept || toDept) {
      const branchId = fromId || DEFAULT_BRANCH_ID;
      for (const item of items) {
        const qty = itemStockQty(item);
        if (qty <= 0) continue;

        let sourceDept = fromDept;
        let targetDept = toDept;
        if (fromDept && toDept) {
          // direct transfer
        } else if (!fromDept && toDept) {
          sourceDept = getDefaultDepartmentId(branchId);
          if (!sourceDept) throw new Error('Не найден отдел-источник для перемещения');
        } else if (fromDept && !toDept) {
          targetDept = getDefaultDepartmentId(branchId);
          if (!targetDept) throw new Error('Не найден отдел-получатель для перемещения');
        }

        const vid = variantId(item);
        if (multiplier > 0) {
          // Capture avg cost from source BEFORE transfer so reversal uses the same value
          const unitCostAtTransfer = getDepartmentAvgCost(sourceDept, item.product_id, vid);
          transferDepartmentStock(sourceDept, targetDept, item.product_id, qty, vid);
          run(
            'UPDATE document_items SET unit_cost = ? WHERE id = ?',
            [unitCostAtTransfer, item.id],
          );
        } else {
          // Use cost stored at confirm-time; fall back to current avg only if not set
          const unitCost = Number(item.unit_cost) > 0
            ? Number(item.unit_cost)
            : getDepartmentAvgCost(targetDept, item.product_id, vid);
          reverseTransferDepartmentStock(sourceDept, targetDept, item.product_id, qty, unitCost, vid);
        }
        afterVariantStockChange(vid, item.product_id, branchId);
        syncBranchStockFromDepartments(branchId, item.product_id);
      }
      return;
    }

    if (!fromId || !toId) return;
    if (fromId === toId) throw new Error('Филиалы отправления и получения должны отличаться');
    for (const item of items) {
      const qty = itemStockQty(item);
      if (qty <= 0) continue;
      adjustBranchStock(fromId, item.product_id, -qty * multiplier);
      adjustBranchStock(toId, item.product_id, qty * multiplier);
    }
    return;
  }

  const branchId = doc.branch_id || DEFAULT_BRANCH_ID;
  items.forEach((item, idx) => {
    const qty = Math.abs(item.quantity);
    if (qty <= 0) return;
    const vid = variantId(item);

    if (doc.type === 'prihod' && doc.to_department_id) {
      const stockQty = itemStockQty(item);
      const lineAmount = itemLineAmount(item);
      const extraAmount = allocatedExtras[idx] || 0;
      const unitCost = stockQty > 0 ? (lineAmount + extraAmount) / stockQty : 0;
      if (multiplier > 0) {
        receiveDepartmentStock(doc.to_department_id, item.product_id, stockQty, unitCost, vid);
      } else {
        reverseReceiveDepartmentStock(doc.to_department_id, item.product_id, stockQty, unitCost, vid);
      }
      afterVariantStockChange(vid, item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    } else if (doc.type === 'return_customer' && doc.to_department_id) {
      const unitCost = Number(item.unit_cost) || 0;
      if (multiplier > 0) {
        receiveDepartmentStock(doc.to_department_id, item.product_id, qty, unitCost, vid);
      } else {
        reverseReceiveDepartmentStock(doc.to_department_id, item.product_id, qty, unitCost, vid);
      }
      afterVariantStockChange(vid, item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    } else if (isOutgoingDocType(doc.type) && doc.from_department_id) {
      if (multiplier > 0) {
        const issued = issueDepartmentStock(doc.from_department_id, item.product_id, qty, vid);
        if (doc.type === 'rashod') {
          run(
            'UPDATE document_items SET unit_cost = ?, cost_amount = ? WHERE id = ?',
            [issued.unitCost, issued.totalCost, item.id],
          );
        }
      } else {
        reverseIssueDepartmentStock(
          doc.from_department_id,
          item.product_id,
          qty,
          item.unit_cost || item.price || 0,
          vid,
        );
        if (doc.type === 'rashod') {
          run('UPDATE document_items SET unit_cost = 0, cost_amount = 0 WHERE id = ?', [item.id]);
        }
      }
      afterVariantStockChange(vid, item.product_id, branchId);
      syncBranchStockFromDepartments(branchId, item.product_id);
    }
  });

  if (!reverse && doc.type === 'prihod') {
    syncSupplierPriceListFromPrihod(doc, items);
  }
}

/** Складское кол-во строки: нетто × шт, если нетто > 0, иначе quantity. */
function itemStockQty(item) {
  const qty = Math.abs(Number(item.quantity) || 0);
  const net = Number(item.net_weight) || 0;
  return net > 0 ? net * qty : qty;
}

function getItemStockLabel(item) {
  if (item.variant_id) {
    const row = queryOne(`
      SELECT pv.name as variant_name, p.name as product_name
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = ?
    `, [item.variant_id]);
    if (row) return `${row.product_name} — ${row.variant_name}`;
  }
  const product = queryOne('SELECT name FROM products WHERE id = ?', [item.product_id]);
  return product?.name || 'товар';
}

function validateRashodStock(branchId, fromDepartmentId, items, reverse = false) {
  if (reverse) return;
  if (!fromDepartmentId) throw new Error('Выберите отдел для расхода/возврата');
  assertDepartmentInBranch(fromDepartmentId, branchId);
  for (const item of items) {
    const stock = getDepartmentStock(item.product_id, fromDepartmentId, item.variant_id || null);
    if (stock < item.quantity) {
      const label = getItemStockLabel(item);
      throw new Error(`Недостаточно остатка «${label}» (есть ${stock})`);
    }
  }
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

function validatePeremeshchenie(fromBranchId, toBranchId, fromDept, toDept, items, reverse = false) {
  if (fromDept || toDept) {
    if (fromBranchId !== toBranchId) {
      throw new Error('Для перемещения между отделами выберите один филиал');
    }
    if (fromDept && toDept && fromDept === toDept) {
      throw new Error('Отделы отправления и получения должны отличаться');
    }
    validateDepartmentTransfer(fromBranchId, fromDept, toDept, items, reverse);
    return;
  }
  if (!toBranchId) throw new Error('Укажите филиал получателя');
  if (fromBranchId === toBranchId) throw new Error('Филиалы отправления и получения должны отличаться');
  validateTransferStock(fromBranchId, items, reverse);
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
  for (const item of items) {
    const stock = item.variant_id
      ? getVariantBranchStock(item.variant_id, fromBranchId)
      : getBranchStock(item.product_id, fromBranchId);
    const qty = itemStockQty(item);
    if (stock < qty) {
      const label = getItemStockLabel(item);
      throw new Error(`Недостаточно остатка «${label}» на филиале-отправителе (есть ${stock})`);
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
    return attachInventoryListAmounts(attachRemaindersToDocuments(rows));
  }
  return rows;
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
           ica.name as article_name
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    LEFT JOIN counterparty_contracts cc ON cc.id = d.contract_id
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
             COALESCE(pds.stock, 0) as stock
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
             ), COALESCE(pbs.stock, 0)) as stock
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

  return {
    ...doc,
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

function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function inventoryLineDiff(item) {
  return (Number(item.quantity) || 0) - (Number(item.book_qty) || 0);
}

function inventoryLineCost(item) {
  const stored = Number(item.unit_cost);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return Math.max(0, Number(item.price) || 0);
}

function inventoryTotals(items) {
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

function normalizeInventoryItems(items) {
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
    const cost = Math.max(0, Number(item.unit_cost ?? item.price) || 0);
    const amount = roundMoney(Math.abs(fact - book) * cost);
    return {
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      quantity: fact,
      book_qty: book,
      price: cost,
      unit_cost: cost,
      amount,
      cost_amount: amount,
    };
  });
}

function assertNoOpenInventoryDraft(departmentId, branchId, exceptId = null) {
  if (!departmentId) return;
  const params = [departmentId, branchId];
  let sql = `
    SELECT number FROM documents
    WHERE type = 'inventory' AND status = 'draft'
      AND to_department_id = ? AND branch_id = ?
      AND COALESCE(inventory_coverage, 'partial') != 'remainder'
  `;
  if (exceptId) {
    sql += ' AND id != ?';
    params.push(exceptId);
  }
  const existing = queryOne(sql, params);
  if (existing) {
    throw new Error(`По этому отделу уже есть черновик инвентаризации №${existing.number}`);
  }
}

function inventoryLineKey(item) {
  return `${item.product_id}:${item.variant_id || ''}`;
}

function normalizeInventoryCoverage(value, existing = null) {
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

function assertExpenseArticle(articleId, branchId) {
  if (!articleId) throw new Error('Выберите статью списания');
  const article = getCashArticle(articleId, branchId);
  if (!article || !article.active) throw new Error('Статья не найдена');
  if (article.direction !== 'expense') throw new Error('Для списания нужна статья расхода');
  return article;
}

function normalizeInventoryLiable(data, branchId, existing = null) {
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

function findInventoryRemainder(parentId) {
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

function loadRemainderSummary(parentId) {
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

function attachRemaindersToDocuments(docs) {
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

function attachInventoryListAmounts(docs) {
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

function reverseInventoryRemainder(parentId, userId = null) {
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

function createInventoryRemainderWriteoff(parent, countedItems, userId = null) {
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
    const fact = Number(item.quantity) || 0;
    const book = Number(item.book_qty) || 0;
    const amount = roundMoney(Math.abs(fact - book) * cost);
    return {
      ...item,
      unit_cost: cost,
      price: cost || Number(item.price) || 0,
      amount,
      cost_amount: amount,
      stock_amount: roundMoney(fact * cost),
    };
  });
}

function inventoryCountedStockAmount(items) {
  return roundMoney((items || []).reduce((sum, item) => (
    sum + (Number(item.stock_amount) || ((Number(item.quantity) || 0) * inventoryLineCost(item)))
  ), 0));
}

function inventoryStockAmountFields(doc, items, { includeWriteoffItems = false } = {}) {
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

function applyInventoryBookSnapshot(departmentId, items) {
  return (items || []).map((item) => {
    const vid = item.variant_id || null;
    const { stock, avgCost } = getDepartmentStockWithCost(departmentId, item.product_id, vid);
    const fact = Number(item.quantity) || 0;
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

function writeInventoryBookSnapshot(items) {
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

function persistInventoryItems(documentId, items) {
  items.forEach((item, idx) => {
    run(`
      INSERT INTO document_items (
        id, document_id, product_id, variant_id, quantity, price, amount,
        item_role, unit_cost, cost_amount, book_qty, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'input', ?, ?, ?, ?)
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
      idx,
    ]);
  });
}

function validateInventoryShortage(departmentId, items) {
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

function applyInventoryStock(doc, items, reverse) {
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
    const product = queryOne('SELECT id, name, unit FROM products WHERE id = ?', [productId]);
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
    return [{
      product_id: productId,
      variant_id: vid,
      name,
      variant_name: variantName,
      unit,
      book_qty: Number(stock) || 0,
      avg_cost: avg,
      suggest_cost: avg > 0 ? 0 : lastPrihodUnitCost(departmentId, productId, vid),
    }];
  }
  const lastMap = lastPrihodUnitCostMap(departmentId);
  return getStockReport(branchId, departmentId, true).map((row) => {
    const vid = row.variant_id || null;
    const avg = Number(row.unitCost) || 0;
    return {
      product_id: row.product_id,
      variant_id: vid,
      name: row.name,
      variant_name: row.variant_name || null,
      unit: row.unit,
      book_qty: Number(row.stock) || 0,
      avg_cost: avg,
      suggest_cost: avg > 0 ? 0 : (lastMap.get(`${row.product_id}:${vid || ''}`) || 0),
    };
  });
}

function itemLineAmount(item) {
  const stored = Number(item.amount);
  if (Number.isFinite(stored)) return stored;
  return roundMoney((Number(item.quantity) || 0) * (Number(item.price) || 0));
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

function normalizeRazdelkaItems(data) {
  const inputItems = (data.input_items || []).filter((i) => i.product_id);
  if (inputItems.length === 0) throw new Error('Добавьте сырьё (вход)');
  return { inputItems };
}


function getInputProcessedWeight(input, calcItems = []) {
  if (input.outputs && typeof input.outputs === 'object' && !Array.isArray(input.outputs)) {
    return Object.values(input.outputs).reduce((s, v) => s + (Number(v) || 0), 0);
  }
  if (Array.isArray(input.outputs)) {
    return input.outputs.reduce((s, o) => s + (Number(o.quantity) || 0), 0);
  }
  const legacy = (Number(input.toza) || 0) + (Number(input.qiymali) || 0) + (Number(input.otkhod) || 0);
  if (legacy > 0) return legacy;
  if (calcItems.length) {
    return calcItems.reduce((s, ci, idx) => {
      const keys = ['toza', 'qiymali', 'otkhod'];
      return s + (Number(input[keys[idx]]) || 0);
    }, 0);
  }
  return Number(input.quantity) || 0;
}

function expandInputOutputs(input, calcItems) {
  if (input.outputs && typeof input.outputs === 'object' && !Array.isArray(input.outputs)) {
    return calcItems.map((ci) => ({
      product_id: ci.product_id,
      variant_id: ci.variant_id || null,
      quantity: Number(input.outputs[calcLineKey(ci.product_id, ci.variant_id)]) || 0,
      is_waste: !!ci.is_waste,
    }));
  }
  if (Array.isArray(input.outputs)) {
    return input.outputs.map((o) => {
      const ci = calcItems.find((item) =>
        item.product_id === o.product_id
        && (item.variant_id || null) === (o.variant_id || null));
      return {
        product_id: o.product_id,
        variant_id: o.variant_id || null,
        quantity: Number(o.quantity) || 0,
        is_waste: ci ? !!ci.is_waste : !!o.is_waste,
      };
    });
  }

  const legacy = [
    { key: 'toza', idx: 0 },
    { key: 'qiymali', idx: 1 },
    { key: 'otkhod', idx: 2 },
  ];
  return calcItems.map((ci, idx) => {
    const legacyKey = legacy[idx]?.key;
    return {
      product_id: ci.product_id,
      variant_id: ci.variant_id || null,
      quantity: legacyKey ? (Number(input[legacyKey]) || 0) : 0,
      is_waste: !!ci.is_waste,
    };
  });
}

function buildRazdelkaOutputItemsFromInput(inputItems, calculationId, branchId = null) {
  if (!calculationId) {
    throw new Error('Выберите калькуляцию');
  }

  const calc = getCalculation(calculationId, branchId);
  if (!calc) throw new Error('Калькуляция не найдена');
  if (calc.kind === 'recipe') {
    throw new Error('Для разделки выберите калькуляцию разделки, не рецепт блюда');
  }

  const calcItems = calc.items || [];
  const calcSources = calc.sources || [];
  if (calcItems.length === 0) {
    throw new Error('В калькуляции нет выходных товаров');
  }

  const outputs = [];

  for (const input of inputItems) {
    const rowOutputs = expandInputOutputs(input, calcItems);
    const weight = rowOutputs.reduce((s, o) => s + o.quantity, 0);
    if (weight <= 0) {
      throw new Error('Укажите количество по позициям калькуляции');
    }

    if (calcSources.length > 0 && !calcSources.some((s) =>
      s.product_id === input.product_id
      && (s.variant_id || null) === (input.variant_id || null))) {
      const product = queryOne('SELECT name FROM products WHERE id = ?', [input.product_id]);
      throw new Error(`«${product?.name || 'товар'}» не входит в выбранную калькуляцию`);
    }

    for (const row of rowOutputs) {
      if (row.quantity <= 0) continue;
      outputs.push({
        product_id: row.product_id,
        variant_id: row.variant_id || null,
        quantity: row.quantity,
        is_waste: !!row.is_waste,
        toza: 0,
        qiymali: 0,
        otkhod: 0,
      });
    }
  }

  const sellable = outputs.filter((o) => !o.is_waste);
  if (sellable.length === 0) {
    throw new Error('Укажите выход без отхода — на склад попадают только продаваемые позиции');
  }

  return outputs;
}

function enrichRazdelkaItemPrices(items, fromDepartmentId = null, branchId = DEFAULT_BRANCH_ID) {
  return items.map((item) => {
    if (item.price != null && item.price > 0) return item;
    if (fromDepartmentId) {
      const avgCost = getDepartmentAvgCost(fromDepartmentId, item.product_id, item.variant_id || null);
      if (avgCost > 0) return { ...item, price: avgCost };
    }
    const price = getEffectiveProductPrice(item.product_id, branchId, item.variant_id || null);
    return { ...item, price };
  });
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

function prepareRazdelkaOutputs(inputItems, outputItems, fromDepartmentId = null, branchId = DEFAULT_BRANCH_ID) {
  const enrichedInputs = enrichRazdelkaItemPrices(inputItems, fromDepartmentId, branchId);
  const inputTotal = enrichedInputs.reduce((s, i) => {
    const price = Number(i.price) || 0;
    const qty = getInputProcessedWeight(i);
    return s + qty * price;
  }, 0);

  const prepared = (outputItems || [])
    .filter((i) => i.product_id)
    .map((item) => {
      const quantity = Number(item.quantity) || (Number(item.toza) || 0) + (Number(item.qiymali) || 0);
      return {
        ...item,
        quantity,
        is_waste: !!item.is_waste,
        toza: Number(item.toza) || 0,
        qiymali: Number(item.qiymali) || 0,
        otkhod: Number(item.otkhod) || 0,
      };
    })
    .filter((i) => i.quantity > 0);

  if (prepared.length === 0) throw new Error('Добавьте продукцию после разделки');

  const sellableWeight = prepared
    .filter((i) => !i.is_waste)
    .reduce((s, i) => s + i.quantity, 0);
  if (sellableWeight <= 0) throw new Error('Укажите выход без отхода');
  const unitCost = inputTotal / sellableWeight;

  return prepared.map((i) => ({
    ...i,
    price: i.is_waste ? 0 : Math.round(unitCost * 100) / 100,
    quantity: i.is_waste ? 0 : i.quantity,
    toza: i.is_waste ? 0 : i.quantity,
    qiymali: 0,
    otkhod: i.is_waste ? i.quantity : (Number(i.otkhod) || 0),
  }));
}

function validateRazdelka(branchId, fromDept, toDept, inputItems, reverse = false, outputItems = [], allowSameDepartment = false) {
  if (!fromDept) throw new Error('Выберите отдел-источник (откуда сырьё)');
  if (!toDept) throw new Error('Выберите отдел, куда попадёт продукция');
  assertDepartmentInBranch(fromDept, branchId);
  assertDepartmentInBranch(toDept, branchId);
  if (!reverse && fromDept === toDept && !allowSameDepartment) {
    throw new Error('Отдел-источник и отдел-получатель должны отличаться');
  }
  if (reverse) {
    for (const item of outputItems) {
      const stock = getDepartmentStock(item.product_id, toDept, item.variant_id || null);
      if (stock < item.quantity) {
        throw new Error(`Недостаточно «${getItemStockLabel(item)}» в цехе для отмены (есть ${stock})`);
      }
    }
    return;
  }
  for (const item of inputItems) {
    const weight = getInputProcessedWeight(item);
    const qty = weight > 0 ? weight : Number(item.quantity) || 0;
    const stock = getDepartmentStock(item.product_id, fromDept, item.variant_id || null);
    if (stock < qty) {
      const label = getItemStockLabel(item);
      const unit = queryOne('SELECT unit FROM products WHERE id = ?', [item.product_id])?.unit || 'кг';
      throw new Error(`Недостаточно «${label}» в отделе-источнике: указано ${qty} ${unit}, есть ${stock} ${unit}`);
    }
  }
}

function calcRazdelkaTotal(outputItems) {
  return outputItems.reduce((s, i) => s + i.quantity * (i.price || 0), 0);
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

  if (willConfirm) {
    buildDishSalePlan(items, fromDept, docBranchId);
  }

  transaction(() => {
    if (wasConfirmed) updateStock(id, true);

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
  const id = existingId || uuidv4();
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

  const items = normalizeItems(data.items);

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
    validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items);
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

  transaction(() => {
    run(`
      INSERT INTO documents (id, number, type, counterparty_id, contract_id, date, comment, from_location, to_location,
        branch_id, from_branch_id, to_branch_id, from_department_id, to_department_id, source_document_id, total_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, number, data.type, data.counterparty_id || null, contractId,
      data.date, data.comment || '', data.from_location || '', data.to_location || '',
      docBranchId, fromBranchId, toBranchId,
      isOutgoingDocType(data.type) ? rashodFromDepartmentId : fromDepartmentId,
      toDepartmentId,
      sourceDocumentId,
      total, data.status || 'draft',
    ]);

    items.forEach((item, idx) => {
      run(`
        INSERT INTO document_items (id, document_id, product_id, variant_id, quantity, price, amount, item_role, net_weight, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'input', ?, ?)
      `, [uuidv4(), id, item.product_id, item.variant_id || null, item.quantity, item.price, item.amount, item.net_weight ?? null, idx]);
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
        assertRazdelkaCanReverse(id, existingDoc);
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
        data.date,
        data.comment || '',
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

  const counterpartyId = data.counterparty_id ?? existingDoc.counterparty_id;
  const items = normalizeItems(data.items);

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
    validatePeremeshchenie(fromBranchId, toBranchId, fromDepartmentId, toDepartmentId, items);
  }

  const wasConfirmed = existingDoc.status === 'confirmed';
  const willConfirm = data.status === 'confirmed' || (wasConfirmed && data.status !== 'draft');
  const { extras, replace: replaceExtras } = extraCostsForWrite(data, docType, id);
  assertExtraCostsAllocatable(items, extras);

  transaction(() => {
    if (wasConfirmed) updateStock(id, true);

    if (willConfirm && !wasConfirmed) {
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

    run(`
      UPDATE documents
      SET counterparty_id=?, contract_id=?, date=?, comment=?, from_location=?, to_location=?,
          branch_id=?, from_branch_id=?, to_branch_id=?, from_department_id=?, to_department_id=?, source_document_id=?,
          total_amount=?, status=?, updated_at=datetime('now')
      WHERE id=?
    `, [
      data.counterparty_id || null, contractId, data.date, data.comment || '',
      data.from_location || '', data.to_location || '',
      docBranchId, fromBranchId, toBranchId, savedFromDepartmentId, toDepartmentId, sourceDocumentId,
      total, data.status || existingDoc.status, id,
    ]);

    run('DELETE FROM document_items WHERE document_id = ?', [id]);

    items.forEach((item, idx) => {
      run(`
        INSERT INTO document_items (id, document_id, product_id, variant_id, quantity, price, amount, item_role, net_weight, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'input', ?, ?)
      `, [uuidv4(), id, item.product_id, item.variant_id || null, item.quantity, item.price, item.amount, item.net_weight ?? null, idx]);
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
    const effectiveToDept = toDept || getDefaultDepartmentId(toId || fromId);
    if (effectiveToDept) {
      for (const item of items) {
        const stock = getDepartmentStock(item.product_id, effectiveToDept, item.variant_id || null);
        if (stock < item.quantity) {
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
      if (stock < item.quantity) {
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
    assertRazdelkaCanReverse(id, doc);
    const items = queryAll('SELECT * FROM document_items WHERE document_id = ?', [id]);
    assertTransferCanReverse(doc, items);
    if (remainder?.status === 'confirmed') {
      assertNoLaterStockMovements(remainder);
      assertNoLaterStockMovements(doc, null, [remainder.id]);
    } else {
      assertNoLaterStockMovements(doc);
    }
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
  if (remainder) {
    const remPayments = queryOne('SELECT COUNT(*) as c FROM payments WHERE document_id = ?', [remainder.id])?.c || 0;
    if (remPayments > 0) {
      throw new Error('Нельзя удалить документ: есть оплаты по списанию непересчитанного.');
    }
  }
  const linkedPayments = queryOne('SELECT COUNT(*) as c FROM payments WHERE document_id = ?', [id])?.c || 0;
  if (linkedPayments > 0) {
    throw new Error('Нельзя удалить документ: есть привязанные оплаты. Сначала отвяжите или удалите оплаты.');
  }

  if (doc.status === 'confirmed') {
    assertRazdelkaCanReverse(id, doc);
    if (remainder?.status === 'confirmed') {
      assertNoLaterStockMovements(remainder);
      assertNoLaterStockMovements(doc, null, [remainder.id]);
    } else {
      assertNoLaterStockMovements(doc);
    }
  }

  transaction(() => {
    if (remainder) {
      if (remainder.status === 'confirmed') updateStock(remainder.id, true);
      run('DELETE FROM documents WHERE id = ?', [remainder.id]);
    }
    if (doc.status === 'confirmed') {
      updateStock(id, true);
    }
    run('DELETE FROM telegram_messages WHERE document_id = ?', [id]);
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
  return queryAll(`
    SELECT h.id, h.document_id, h.action, h.snapshot, h.changed_by, h.created_at,
           u.name as changed_by_name
    FROM document_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.document_id = ?
    ORDER BY h.created_at DESC
  `, [documentId]).map((row) => ({
    ...row,
    user_name: formatChangedBy(row),
  }));
}