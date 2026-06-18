import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

const { queryOne, run, queryAll } = db;

function scopeSql(departmentId, productId, variantId = null) {
  if (variantId) {
    return {
      where: 'department_id = ? AND product_id = ? AND variant_id = ?',
      params: [departmentId, productId, variantId],
    };
  }
  return {
    where: 'department_id = ? AND product_id = ? AND (variant_id IS NULL OR variant_id = \'\')',
    params: [departmentId, productId],
  };
}

function getRow(departmentId, productId, variantId = null) {
  const { where, params } = scopeSql(departmentId, productId, variantId);
  return queryOne(
    `SELECT id, stock, avg_cost FROM product_department_stock WHERE ${where}`,
    params,
  );
}

export function getDepartmentAvgCost(departmentId, productId, variantId = null) {
  if (!departmentId || !productId) return 0;
  return getRow(departmentId, productId, variantId)?.avg_cost || 0;
}

export function getDepartmentStockWithCost(departmentId, productId, variantId = null) {
  const row = getRow(departmentId, productId, variantId);
  return { stock: row?.stock || 0, avgCost: row?.avg_cost || 0 };
}

function upsertRow(departmentId, productId, stock, avgCost, variantId = null) {
  const safeStock = Math.max(0, stock);
  const safeAvg = safeStock > 0 ? Math.max(0, avgCost) : 0;
  const row = getRow(departmentId, productId, variantId);
  const { where, params } = scopeSql(departmentId, productId, variantId);
  if (row) {
    run(
      `UPDATE product_department_stock
       SET stock = ?, avg_cost = ?, updated_at = datetime('now')
       WHERE ${where}`,
      [safeStock, safeAvg, ...params],
    );
  } else if (safeStock > 0) {
    run(
      `INSERT INTO product_department_stock (id, department_id, product_id, variant_id, stock, avg_cost)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), departmentId, productId, variantId || null, safeStock, safeAvg],
    );
  }
}

export function setDepartmentStock(departmentId, productId, qty, unitCost, variantId = null) {
  if (!departmentId || !productId || qty < 0) return;
  const cost = Math.max(0, Number(unitCost) || 0);
  if (qty <= 1e-9) {
    upsertRow(departmentId, productId, 0, 0, variantId);
    return;
  }
  upsertRow(departmentId, productId, qty, cost, variantId);
}

export function receiveDepartmentStock(departmentId, productId, qty, unitCost, variantId = null) {
  if (!departmentId || !productId || qty <= 0) return;
  const cost = Math.max(0, Number(unitCost) || 0);
  const row = getRow(departmentId, productId, variantId);
  const oldStock = row?.stock || 0;
  const oldAvg = row?.avg_cost || 0;
  const newStock = oldStock + qty;
  const newAvg = (oldStock * oldAvg + qty * cost) / newStock;
  upsertRow(departmentId, productId, newStock, newAvg, variantId);
}

export function issueDepartmentStock(departmentId, productId, qty, variantId = null) {
  if (!departmentId || !productId || qty <= 0) return { unitCost: 0, totalCost: 0 };
  const row = getRow(departmentId, productId, variantId);
  const oldStock = row?.stock || 0;
  if (oldStock + 1e-9 < qty) {
    throw new Error('Недостаточно остатка для списания');
  }
  const unitCost = row?.avg_cost || 0;
  const newStock = oldStock - qty;
  upsertRow(departmentId, productId, newStock, newStock > 0 ? unitCost : 0, variantId);
  return { unitCost, totalCost: unitCost * qty };
}

export function transferDepartmentStock(fromDepartmentId, toDepartmentId, productId, qty, variantId = null) {
  if (!fromDepartmentId || !toDepartmentId || !productId || qty <= 0) return;
  if (fromDepartmentId === toDepartmentId) return;
  const { unitCost } = issueDepartmentStock(fromDepartmentId, productId, qty, variantId);
  receiveDepartmentStock(toDepartmentId, productId, qty, unitCost, variantId);
}

export function reverseReceiveDepartmentStock(departmentId, productId, qty, unitCost, variantId = null) {
  if (!departmentId || !productId || qty <= 0) return;
  const cost = Math.max(0, Number(unitCost) || 0);
  const row = getRow(departmentId, productId, variantId);
  const oldStock = row?.stock || 0;
  const oldAvg = row?.avg_cost || 0;
  const newStock = oldStock - qty;
  if (newStock <= 1e-9) {
    upsertRow(departmentId, productId, 0, 0, variantId);
    return;
  }
  const newAvg = (oldStock * oldAvg - qty * cost) / newStock;
  upsertRow(departmentId, productId, newStock, Math.max(0, newAvg), variantId);
}

export function reverseIssueDepartmentStock(departmentId, productId, qty, unitCost, variantId = null) {
  receiveDepartmentStock(departmentId, productId, qty, unitCost, variantId);
}

export function reverseTransferDepartmentStock(fromDepartmentId, toDepartmentId, productId, qty, unitCost, variantId = null) {
  if (!fromDepartmentId || !toDepartmentId || !productId || qty <= 0) return;
  reverseReceiveDepartmentStock(toDepartmentId, productId, qty, unitCost, variantId);
  receiveDepartmentStock(fromDepartmentId, productId, qty, unitCost, variantId);
}

export function getVariantBranchStock(variantId, branchId) {
  const row = queryOne(`
    SELECT COALESCE(SUM(pds.stock), 0) as stock
    FROM product_department_stock pds
    JOIN departments d ON d.id = pds.department_id
    WHERE pds.variant_id = ? AND d.branch_id = ?
  `, [variantId, branchId]);
  return row?.stock || 0;
}

export function syncVariantCatalogStock(variantId, branchId) {
  const total = getVariantBranchStock(variantId, branchId);
  run('UPDATE product_variants SET stock = ? WHERE id = ?', [total, variantId]);
  const row = queryOne('SELECT product_id FROM product_variants WHERE id = ?', [variantId]);
  return row?.product_id || null;
}

export function deleteVariantDepartmentStock(variantId) {
  run('DELETE FROM product_department_stock WHERE variant_id = ?', [variantId]);
}
