import db from '../db.js';
import { getDefaultDepartmentId, getDepartmentStock, syncBranchStockFromDepartments } from '../departments.js';
import { getDepartmentAvgCost, syncVariantCatalogStock, transferDepartmentStock } from '../inventoryCost.js';

const { queryAll, queryOne, run, transaction } = db;

function stockQty(item) {
  const qty = Math.abs(Number(item.quantity) || 0);
  const net = Number(item.net_weight) || 0;
  return net > 0 ? net * qty : qty;
}

function itemLabel(item) {
  const row = queryOne(`
    SELECT p.name AS product_name, pv.name AS variant_name
    FROM products p LEFT JOIN product_variants pv ON pv.id = ?
    WHERE p.id = ?
  `, [item.variant_id || null, item.product_id]);
  if (!row) return 'товар';
  return row.variant_name ? `${row.product_name} — ${row.variant_name}` : row.product_name;
}

/**
 * Старые проведённые межфилиальные перемещения без отделов меняли только `product_branch_stock`,
 * который потом перезаписывается из остатков отделов — товар фактически не переезжал.
 * Переносит остаток между отделами по умолчанию и записывает их в документ.
 * Без `apply` только показывает, что будет сделано.
 */
export function repairLegacyInterBranchTransfers({ apply = false } = {}) {
  const docs = queryAll(`
    SELECT id, number, date, from_branch_id, to_branch_id
    FROM documents
    WHERE type = 'peremeshchenie' AND status = 'confirmed'
      AND from_branch_id IS NOT NULL AND to_branch_id IS NOT NULL
      AND from_branch_id != to_branch_id
      AND (from_department_id IS NULL OR from_department_id = '')
      AND (to_department_id IS NULL OR to_department_id = '')
    ORDER BY date ASC, created_at ASC
  `);

  const result = { apply, fixed: [], skipped: [] };
  for (const doc of docs) {
    const fromDept = getDefaultDepartmentId(doc.from_branch_id);
    const toDept = getDefaultDepartmentId(doc.to_branch_id);
    const base = { id: doc.id, number: doc.number, date: doc.date, from: doc.from_branch_id, to: doc.to_branch_id };
    if (!fromDept || !toDept) {
      result.skipped.push({ ...base, reason: 'у филиала нет активного отдела' });
      continue;
    }
    const items = queryAll('SELECT * FROM document_items WHERE document_id = ?', [doc.id]);
    const shortages = items
      .map((item) => ({ item, need: stockQty(item), have: getDepartmentStock(item.product_id, fromDept, item.variant_id || null) }))
      .filter((r) => r.need > 0 && r.have + 1e-9 < r.need)
      .map((r) => `${itemLabel(r.item)}: есть ${r.have}, нужно ${r.need}`);
    if (shortages.length) {
      result.skipped.push({ ...base, reason: `не хватает остатка у отправителя: ${shortages.join('; ')}` });
      continue;
    }
    if (apply) {
      transaction(() => {
        for (const item of items) {
          const qty = stockQty(item);
          if (qty <= 0) continue;
          const vid = item.variant_id || null;
          const unitCost = getDepartmentAvgCost(fromDept, item.product_id, vid);
          transferDepartmentStock(fromDept, toDept, item.product_id, qty, vid);
          run('UPDATE document_items SET unit_cost = ? WHERE id = ?', [unitCost, item.id]);
          for (const branchId of [doc.from_branch_id, doc.to_branch_id]) {
            if (vid) syncVariantCatalogStock(vid, branchId);
            syncBranchStockFromDepartments(branchId, item.product_id);
          }
        }
        run(
          'UPDATE documents SET from_department_id = ?, to_department_id = ? WHERE id = ?',
          [fromDept, toDept, doc.id],
        );
      });
    }
    result.fixed.push({ ...base, from_department_id: fromDept, to_department_id: toDept, items: items.length });
  }
  return result;
}
