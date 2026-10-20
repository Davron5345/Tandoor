import db from '../db.js';
import { adjustBranchStock, DEFAULT_BRANCH_ID } from '../branches.js';
import { getDefaultDepartmentId, syncBranchStockFromDepartments } from '../departments.js';
import {
  getDepartmentAvgCost,
  issueDepartmentStock,
  receiveDepartmentStock,
  reverseIssueDepartmentStock,
  reverseReceiveDepartmentStock,
  reverseTransferDepartmentStock,
  syncVariantCatalogStock,
  transferDepartmentStock,
} from '../inventoryCost.js';
import { syncSupplierPriceListFromPrihod } from './supplierPrices.js';
import { allocateExtraCosts } from '../documentExtraCosts.js';
import { addDocumentHistory } from '../documentSnapshot.js';
import { applyInventoryStock } from './documentInventory.js';

const { queryAll, queryOne, run } = db;

export function generateDocNumber(branchId = DEFAULT_BRANCH_ID, docType) {
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

export function isOutgoingDocType(type) {
  return type === 'rashod' || type === 'return_supplier';
}

export function addHistory(documentId, action, userId = null) {
  addDocumentHistory(documentId, action, userId);
}

export function afterVariantStockChange(variantId, productId, branchId) {
  if (!variantId) return;
  syncVariantCatalogStock(variantId, branchId);
  syncBranchStockFromDepartments(branchId, productId);
}

export function updateStock(documentId, reverse = false) {
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
        const issued = issueDepartmentStock(fromDept, item.product_id, item.quantity, variantId(item));
        run(
          'UPDATE document_items SET unit_cost = ?, cost_amount = ? WHERE id = ?',
          [issued.unitCost, issued.totalCost, item.id],
        );
      } else {
        const unitCost = Number(item.unit_cost) > 0 ? Number(item.unit_cost) : (item.price || 0);
        reverseIssueDepartmentStock(fromDept, item.product_id, item.quantity, unitCost, variantId(item));
        run('UPDATE document_items SET unit_cost = 0, cost_amount = 0 WHERE id = ?', [item.id]);
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
    let fromDept = doc.from_department_id || null;
    let toDept = doc.to_department_id || null;

    // Межфилиальное: остаток живёт в отделах, поэтому двигаем его между отделами по умолчанию
    // и запоминаем их в документе. Старые проведённые без отделов отменяются по-старому (ниже).
    if (!fromDept && !toDept && !reverse && fromId && toId && fromId !== toId) {
      fromDept = getDefaultDepartmentId(fromId);
      toDept = getDefaultDepartmentId(toId);
      if (!fromDept) throw new Error('У филиала-отправителя нет активного отдела');
      if (!toDept) throw new Error('У филиала-получателя нет активного отдела');
      run(
        'UPDATE documents SET from_department_id = ?, to_department_id = ? WHERE id = ?',
        [fromDept, toDept, documentId],
      );
    }

    if (fromDept || toDept) {
      const branchId = fromId || DEFAULT_BRANCH_ID;
      const targetBranchId = toId || branchId;
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
        if (targetBranchId !== branchId) {
          afterVariantStockChange(vid, item.product_id, targetBranchId);
          syncBranchStockFromDepartments(targetBranchId, item.product_id);
        }
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
      const outQty = itemStockQty(item);
      if (multiplier > 0) {
        const issued = issueDepartmentStock(doc.from_department_id, item.product_id, outQty, vid);
        run(
          'UPDATE document_items SET unit_cost = ?, cost_amount = ? WHERE id = ?',
          [issued.unitCost, issued.totalCost, item.id],
        );
      } else {
        reverseIssueDepartmentStock(
          doc.from_department_id,
          item.product_id,
          outQty,
          item.unit_cost || item.price || 0,
          vid,
        );
        run('UPDATE document_items SET unit_cost = 0, cost_amount = 0 WHERE id = ?', [item.id]);
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
export function itemStockQty(item) {
  const qty = Math.abs(Number(item.quantity) || 0);
  const net = Number(item.net_weight) || 0;
  return net > 0 ? net * qty : qty;
}

export function getItemStockLabel(item) {
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

export function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function itemLineAmount(item) {
  const stored = Number(item.amount);
  if (Number.isFinite(stored)) return stored;
  return roundMoney((Number(item.quantity) || 0) * (Number(item.price) || 0));
}
