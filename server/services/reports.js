import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';

const { queryAll, queryOne } = db;

export function getStockReport(branchId = DEFAULT_BRANCH_ID, departmentId = null, onlyInStock = true) {
  let sql = `
    SELECT pds.stock, COALESCE(pds.avg_cost, 0) as avg_cost, pds.variant_id,
           p.id as product_id, p.name as product_name, p.unit, p.category_id,
           pv.name as variant_name,
           d.id as department_id, d.name as department_name,
           pc.name as category_name
    FROM product_department_stock pds
    JOIN departments d ON d.id = pds.department_id AND d.branch_id = ?
    JOIN products p ON p.id = pds.product_id
    LEFT JOIN product_variants pv ON pv.id = pds.variant_id
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    WHERE (
      COALESCE(p.has_variants, 0) = 0 AND (pds.variant_id IS NULL OR pds.variant_id = '')
      OR COALESCE(p.has_variants, 0) = 1 AND pds.variant_id IS NOT NULL AND pds.variant_id != ''
    )
  `;
  const params = [branchId];
  if (departmentId) {
    sql += ' AND pds.department_id = ?';
    params.push(departmentId);
  }
  if (onlyInStock) {
    sql += ' AND pds.stock > 0';
  }
  sql += ' ORDER BY d.name, p.name, COALESCE(pv.sort_order, 999), pv.name';

  const rows = queryAll(sql, params);

  if (!onlyInStock && departmentId) {
    const missingProducts = queryAll(`
      SELECT p.id as product_id, p.name as product_name, p.unit, p.category_id,
             pc.name as category_name, d.id as department_id, d.name as department_name
      FROM products p
      JOIN departments d ON d.id = ? AND d.branch_id = ?
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE COALESCE(p.has_variants, 0) = 0
        AND NOT EXISTS (
          SELECT 1
          FROM product_department_stock pds
          WHERE pds.department_id = d.id
            AND pds.product_id = p.id
            AND (pds.variant_id IS NULL OR pds.variant_id = '')
        )
      ORDER BY p.name
    `, [departmentId, branchId]);

    for (const product of missingProducts) {
      rows.push({
        ...product,
        variant_id: null,
        variant_name: null,
        stock: 0,
        avg_cost: 0,
      });
    }
  }

  return rows.map((row) => {
    const stock = row.stock || 0;
    const unitCost = row.avg_cost || 0;
    const name = row.variant_name
      ? `${row.product_name} — ${row.variant_name}`
      : row.product_name;
    return {
      rowKey: `${row.department_id}:${row.product_id}:${row.variant_id || ''}`,
      department_id: row.department_id,
      department_name: row.department_name,
      name,
      category_id: row.category_id,
      category_name: row.category_name,
      unit: row.unit || 'шт',
      stock,
      unitCost,
      total: stock * unitCost,
    };
  });
}

function getCounterpartyDebtRows(branchId, counterpartyType, docType, paymentType, includeUnlinkedPayments = true) {
  const rows = queryAll(`
    SELECT c.id, c.name, c.phone, c.email, COALESCE(c.opening_balance, 0) as opening_balance,
      COALESCE((
        SELECT SUM(d.total_amount)
        FROM documents d
        WHERE d.counterparty_id = c.id
          AND d.type = ?
          AND d.status = 'confirmed'
          AND d.branch_id = ?
      ), 0) AS charged,
      COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        LEFT JOIN documents d ON d.id = p.document_id
        WHERE p.branch_id = ?
          AND p.type = ?
          AND (
            (
              p.document_id IS NOT NULL
              AND d.id IS NOT NULL
              AND d.status = 'confirmed'
              AND d.type = ?
              AND d.counterparty_id = c.id
            )
            OR (
              ? = 1
              AND p.document_id IS NULL
              AND p.counterparty_id = c.id
            )
          )
      ), 0) AS paid
    FROM counterparties c
    WHERE c.branch_id = ? AND c.type = ?
    ORDER BY c.name
  `, [
    docType,
    branchId,
    branchId,
    paymentType,
    docType,
    includeUnlinkedPayments ? 1 : 0,
    branchId,
    counterpartyType,
  ]);

  return rows.map((row) => {
    const charged = row.charged || 0;
    const paid = row.paid || 0;
    const openingBalance = row.opening_balance || 0;
    return {
      id: row.id,
      name: row.name,
      phone: row.phone || '',
      email: row.email || '',
      opening_balance: openingBalance,
      charged,
      paid,
      balance: charged - paid + openingBalance,
    };
  });
}

export function getDebtorsReport(branchId = DEFAULT_BRANCH_ID, includeZero = false, includeUnlinkedPayments = true) {
  const rows = getCounterpartyDebtRows(
    branchId,
    'client',
    'rashod',
    'customer_income',
    includeUnlinkedPayments,
  );
  const filtered = includeZero
    ? rows.filter((r) => r.charged > 0 || r.paid > 0 || Math.abs(r.opening_balance || 0) > 0.005)
    : rows.filter((r) => r.balance > 0.005);
  const totalBalance = filtered.reduce((s, r) => s + r.balance, 0);
  return {
    kind: 'debtors',
    title: 'Дебиторы',
    subtitle: 'Клиенты, которые должны нам',
    rows: filtered,
    total_balance: totalBalance,
    count: filtered.length,
  };
}

export function getCreditorsReport(branchId = DEFAULT_BRANCH_ID, includeZero = false, includeUnlinkedPayments = true) {
  const rows = getCounterpartyDebtRows(
    branchId,
    'supplier',
    'prihod',
    'supplier_payment',
    includeUnlinkedPayments,
  );
  const returnedRows = queryAll(`
    SELECT counterparty_id, COALESCE(SUM(total_amount), 0) as returned
    FROM documents
    WHERE branch_id = ?
      AND type = 'return_supplier'
      AND status = 'confirmed'
      AND counterparty_id IS NOT NULL
    GROUP BY counterparty_id
  `, [branchId]);
  const returnedMap = new Map(returnedRows.map((r) => [r.counterparty_id, r.returned || 0]));

  const adjusted = rows.map((r) => {
    const returned = returnedMap.get(r.id) || 0;
    const charged = (r.charged || 0) - returned;
    const paid = r.paid || 0;
    return {
      ...r,
      returned,
      charged,
      balance: charged - paid + (r.opening_balance || 0),
    };
  });

  const filtered = includeZero
    ? adjusted.filter((r) => r.charged > 0 || r.paid > 0 || r.returned > 0 || Math.abs(r.opening_balance || 0) > 0.005)
    : adjusted.filter((r) => r.balance > 0.005);
  const totalBalance = filtered.reduce((s, r) => s + r.balance, 0);
  return {
    kind: 'creditors',
    title: 'Кредиторы',
    subtitle: 'Поставщики, которым мы должны',
    rows: filtered,
    total_balance: totalBalance,
    count: filtered.length,
  };
}

export function getStats(branchId = DEFAULT_BRANCH_ID) {
  const products = queryOne('SELECT COUNT(*) as c FROM products').c;
  const stock = queryOne(`
    SELECT COALESCE(SUM(pds.stock * pds.avg_cost), 0) as v
    FROM product_department_stock pds
    JOIN departments d ON d.id = pds.department_id
    WHERE d.branch_id = ?
  `, [branchId]).v;
  const prihod = queryOne(`
    SELECT COALESCE(SUM(total_amount), 0) as v FROM documents
    WHERE type='prihod' AND status='confirmed' AND branch_id = ?
  `, [branchId]).v;
  const rashod = queryOne(`
    SELECT COALESCE(SUM(total_amount), 0) as v FROM documents
    WHERE type='rashod' AND status='confirmed' AND branch_id = ?
  `, [branchId]).v;
  const docs = queryOne(
    'SELECT COUNT(*) as c FROM documents WHERE branch_id = ? OR from_branch_id = ? OR to_branch_id = ?',
    [branchId, branchId, branchId],
  ).c;

  const branchFilter = [branchId, branchId, branchId];

  const docsByType = queryAll(`
    SELECT type, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
    FROM documents
    WHERE branch_id = ? OR from_branch_id = ? OR to_branch_id = ?
    GROUP BY type
  `, branchFilter);

  const docsByStatus = queryAll(`
    SELECT status, COUNT(*) as count
    FROM documents
    WHERE branch_id = ? OR from_branch_id = ? OR to_branch_id = ?
    GROUP BY status
  `, branchFilter);

  const monthlyActivity = queryAll(`
    SELECT strftime('%Y-%m', date) as month,
           COUNT(*) as count,
           COALESCE(SUM(total_amount), 0) as total
    FROM documents
    WHERE status = 'confirmed'
      AND (branch_id = ? OR from_branch_id = ? OR to_branch_id = ?)
      AND date >= date('now', 'start of month', '-5 months')
    GROUP BY month
    ORDER BY month ASC
  `, branchFilter);

  const topProducts = queryAll(`
    SELECT p.id, p.name, p.unit,
           COALESCE(pbs.stock, 0) as stock,
           COALESCE(pb.price, p.price, 0) as price,
           COALESCE(pbs.stock * COALESCE(pb.price, p.price, 0), 0) as value
    FROM product_branch_stock pbs
    JOIN products p ON p.id = pbs.product_id
    JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = ? AND pb.visible = 1
    WHERE pbs.branch_id = ? AND pbs.stock > 0
    ORDER BY value DESC
    LIMIT 6
  `, [branchId, branchId]);

  const lowStock = queryAll(`
    SELECT p.name, p.unit, pbs.stock
    FROM product_branch_stock pbs
    JOIN products p ON p.id = pbs.product_id
    JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = ? AND pb.visible = 1
    WHERE pbs.branch_id = ? AND pbs.stock > 0 AND pbs.stock <= 10
    ORDER BY pbs.stock ASC, p.name
    LIMIT 6
  `, [branchId, branchId]);

  const confirmedDocs = queryOne(`
    SELECT COUNT(*) as c FROM documents
    WHERE status = 'confirmed'
      AND (branch_id = ? OR from_branch_id = ? OR to_branch_id = ?)
  `, branchFilter).c;

  const draftDocs = queryOne(`
    SELECT COUNT(*) as c FROM documents
    WHERE status = 'draft'
      AND (branch_id = ? OR from_branch_id = ? OR to_branch_id = ?)
  `, branchFilter).c;

  return {
    products,
    stockValue: stock,
    prihodTotal: prihod,
    rashodTotal: rashod,
    documents: docs,
    confirmedDocs,
    draftDocs,
    branchId,
    docsByType,
    docsByStatus,
    monthlyActivity,
    topProducts,
    lowStock,
  };
}
