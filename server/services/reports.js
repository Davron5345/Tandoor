import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { syncBranchStockFromDepartments } from '../departments.js';
import { setDepartmentStock, syncVariantCatalogStock } from '../inventoryCost.js';
import { PURCHASE_ARTICLE_CODE } from '../cashArticleDefaults.js';

const { queryAll, queryOne } = db;

function normalizeSupplierIds(supplierIds) {
  if (supplierIds == null || supplierIds === '') return [];
  const list = Array.isArray(supplierIds) ? supplierIds : String(supplierIds).split(',');
  return [...new Set(list.map((id) => String(id).trim()).filter(Boolean))];
}

export function getStockReport(branchId = DEFAULT_BRANCH_ID, departmentId = null, onlyInStock = true) {
  let sql = `
    SELECT pds.stock, COALESCE(pds.avg_cost, 0) as avg_cost, pds.variant_id,
           p.id as product_id, p.name as product_name, p.unit, p.net_weight, p.category_id,
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
      product_id: row.product_id,
      variant_id: row.variant_id || null,
      name,
      product_name: row.product_name,
      variant_name: row.variant_name || null,
      category_id: row.category_id,
      category_name: row.category_name,
      unit: row.unit || 'шт',
      net_weight: Number(row.net_weight) || 0,
      stock,
      unitCost,
      total: stock * unitCost,
    };
  });
}

export function zeroStockPosition(branchId = DEFAULT_BRANCH_ID, payload = {}) {
  const departmentId = payload.department_id;
  const productId = payload.product_id;
  const variantId = payload.variant_id || null;

  if (!departmentId || !productId) {
    throw new Error('Укажите склад и товар');
  }

  const department = queryOne(
    'SELECT id, name FROM departments WHERE id = ? AND branch_id = ?',
    [departmentId, branchId],
  );
  if (!department) throw new Error('Склад не найден');

  const product = queryOne('SELECT id, name FROM products WHERE id = ?', [productId]);
  if (!product) throw new Error('Товар не найден');

  let variantName = null;
  if (variantId) {
    const variant = queryOne(
      'SELECT id, name FROM product_variants WHERE id = ? AND product_id = ?',
      [variantId, productId],
    );
    if (!variant) throw new Error('Вариант товара не найден');
    variantName = variant.name;
  }

  const stockSql = variantId
    ? 'SELECT stock, avg_cost FROM product_department_stock WHERE department_id = ? AND product_id = ? AND variant_id = ?'
    : `SELECT stock, avg_cost FROM product_department_stock
       WHERE department_id = ? AND product_id = ? AND (variant_id IS NULL OR variant_id = '')`;
  const stockParams = variantId
    ? [departmentId, productId, variantId]
    : [departmentId, productId];
  const stockRow = queryOne(stockSql, stockParams);
  const prevStock = stockRow?.stock || 0;
  if (prevStock <= 0) {
    throw new Error('Остаток уже нулевой');
  }

  setDepartmentStock(departmentId, productId, 0, 0, variantId);
  syncBranchStockFromDepartments(branchId, productId);
  if (variantId) syncVariantCatalogStock(variantId, branchId);

  const label = variantName ? `${product.name} — ${variantName}` : product.name;
  return {
    ok: true,
    department_id: departmentId,
    department_name: department.name,
    product_id: productId,
    variant_id: variantId,
    name: label,
    cleared_qty: prevStock,
    cleared_cost: (stockRow?.avg_cost || 0) * prevStock,
  };
}

function getCounterpartyDebtRows(branchId, counterpartyType, docType, paymentType, includeUnlinkedPayments = true) {
  const openingLineType = counterpartyType === 'client' ? 'debtor' : 'creditor';
  const rows = queryAll(`
    SELECT c.id, c.name, c.phone, c.email,
      (
        COALESCE(c.opening_balance, 0) + COALESCE((
          SELECT SUM(obl.amount)
          FROM opening_balance_lines obl
          JOIN documents d ON d.id = obl.document_id
          WHERE d.type = 'opening_balance' AND d.status = 'confirmed' AND d.branch_id = ?
            AND obl.counterparty_id = c.id AND obl.line_type = ?
        ), 0)
      ) AS opening_balance,
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
        WHERE (p.branch_id = ? OR (p.branch_id IS NULL AND ? = ?))
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
    branchId,
    openingLineType,
    docType,
    branchId,
    branchId,
    branchId,
    DEFAULT_BRANCH_ID,
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

/** Оборотная ведомость по поставщикам за период: долг на начало → приход → оплата → долг на конец. */
export function getSupplierDebtMovementReport(
  branchId = DEFAULT_BRANCH_ID,
  dateFrom,
  dateTo,
  supplierIds = null,
  includeUnlinkedPayments = true,
) {
  if (!dateFrom || !dateTo) {
    throw new Error('Укажите date_from и date_to');
  }
  if (dateFrom > dateTo) {
    throw new Error('date_from не может быть позже date_to');
  }

  const ids = normalizeSupplierIds(supplierIds);
  const supplierFilter = ids.length
    ? ` AND c.id IN (${ids.map(() => '?').join(',')})`
    : '';
  const supplierParams = ids;
  const unlinkedFlag = includeUnlinkedPayments ? 1 : 0;

  const rows = queryAll(`
    SELECT c.id, c.name,
      (
        COALESCE(c.opening_balance, 0) + COALESCE((
          SELECT SUM(obl.amount)
          FROM opening_balance_lines obl
          JOIN documents d ON d.id = obl.document_id
          WHERE d.type = 'opening_balance' AND d.status = 'confirmed' AND d.branch_id = ?
            AND obl.counterparty_id = c.id AND obl.line_type = 'creditor'
        ), 0)
      ) AS base_opening,
      COALESCE((
        SELECT SUM(d.total_amount)
        FROM documents d
        WHERE d.counterparty_id = c.id AND d.type = 'prihod' AND d.status = 'confirmed'
          AND d.branch_id = ? AND d.date < ?
      ), 0) AS prihod_before,
      COALESCE((
        SELECT SUM(d.total_amount)
        FROM documents d
        WHERE d.counterparty_id = c.id AND d.type = 'return_supplier' AND d.status = 'confirmed'
          AND d.branch_id = ? AND d.date < ?
      ), 0) AS return_before,
      COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        LEFT JOIN documents d ON d.id = p.document_id
        WHERE (p.branch_id = ? OR (p.branch_id IS NULL AND ? = ?))
          AND p.type = 'supplier_payment' AND p.date < ?
          AND (
            (
              p.document_id IS NOT NULL
              AND d.id IS NOT NULL
              AND d.status = 'confirmed'
              AND d.type = 'prihod'
              AND d.counterparty_id = c.id
            )
            OR (
              ? = 1
              AND p.document_id IS NULL
              AND p.counterparty_id = c.id
            )
          )
      ), 0) AS paid_before,
      COALESCE((
        SELECT SUM(d.total_amount)
        FROM documents d
        WHERE d.counterparty_id = c.id AND d.type = 'prihod' AND d.status = 'confirmed'
          AND d.branch_id = ? AND d.date >= ? AND d.date <= ?
      ), 0) AS prihod_period,
      COALESCE((
        SELECT SUM(d.total_amount)
        FROM documents d
        WHERE d.counterparty_id = c.id AND d.type = 'return_supplier' AND d.status = 'confirmed'
          AND d.branch_id = ? AND d.date >= ? AND d.date <= ?
      ), 0) AS return_period,
      COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        LEFT JOIN documents d ON d.id = p.document_id
        WHERE (p.branch_id = ? OR (p.branch_id IS NULL AND ? = ?))
          AND p.type = 'supplier_payment'
          AND p.date >= ? AND p.date <= ?
          AND (
            (
              p.document_id IS NOT NULL
              AND d.id IS NOT NULL
              AND d.status = 'confirmed'
              AND d.type = 'prihod'
              AND d.counterparty_id = c.id
            )
            OR (
              ? = 1
              AND p.document_id IS NULL
              AND p.counterparty_id = c.id
            )
          )
      ), 0) AS paid_period
    FROM counterparties c
    WHERE c.branch_id = ? AND c.type = 'supplier'${supplierFilter}
    ORDER BY c.name
  `, [
    branchId,
    branchId, dateFrom,
    branchId, dateFrom,
    branchId, branchId, DEFAULT_BRANCH_ID, dateFrom, unlinkedFlag,
    branchId, dateFrom, dateTo,
    branchId, dateFrom, dateTo,
    branchId, branchId, DEFAULT_BRANCH_ID, dateFrom, dateTo, unlinkedFlag,
    branchId,
    ...supplierParams,
  ]);

  const mapped = rows.map((row) => {
    const openingDebt = (row.base_opening || 0)
      + (row.prihod_before || 0)
      - (row.return_before || 0)
      - (row.paid_before || 0);
    const prihodGross = row.prihod_period || 0;
    const returned = row.return_period || 0;
    const prihod = prihodGross - returned;
    const payment = row.paid_period || 0;
    const closingDebt = openingDebt + prihod - payment;
    return {
      id: row.id,
      name: row.name,
      opening_debt: openingDebt,
      prihod,
      payment,
      closing_debt: closingDebt,
    };
  });

  const filtered = mapped.filter((r) => (
    Math.abs(r.opening_debt) > 0.005
    || Math.abs(r.prihod) > 0.005
    || Math.abs(r.payment) > 0.005
    || Math.abs(r.closing_debt) > 0.005
  ));

  const totals = filtered.reduce((acc, row) => ({
    opening_debt: acc.opening_debt + row.opening_debt,
    prihod: acc.prihod + row.prihod,
    payment: acc.payment + row.payment,
    closing_debt: acc.closing_debt + row.closing_debt,
  }), { opening_debt: 0, prihod: 0, payment: 0, closing_debt: 0 });

  return {
    date_from: dateFrom,
    date_to: dateTo,
    rows: filtered,
    totals,
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
    GROUP BY 1
    ORDER BY 1 ASC
  `, branchFilter);

  const topProducts = queryAll(`
    SELECT p.id, p.name, p.unit,
           COALESCE(SUM(pds.stock), 0) as stock,
           CASE WHEN SUM(pds.stock) > 0
             THEN SUM(pds.stock * pds.avg_cost) / SUM(pds.stock)
             ELSE 0 END as price,
           COALESCE(SUM(pds.stock * pds.avg_cost), 0) as value
    FROM product_department_stock pds
    JOIN departments d ON d.id = pds.department_id AND d.branch_id = ?
    JOIN products p ON p.id = pds.product_id
    JOIN product_branches pb ON pb.product_id = p.id AND pb.branch_id = ? AND pb.visible = 1
    WHERE pds.stock > 0
    GROUP BY p.id, p.name, p.unit
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

function buildDateFilter(column, dateFrom, dateTo, params) {
  let sql = '';
  if (dateFrom) {
    sql += ` AND ${column} >= ?`;
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ` AND ${column} <= ?`;
    params.push(dateTo);
  }
  return sql;
}

/** Платежи только своего филиала (legacy NULL → только main). */
function paymentsBranchFilterSql(alias = 'p') {
  return `(${alias}.branch_id = ? OR (${alias}.branch_id IS NULL AND ? = ?))`;
}

function paymentsBranchFilterParams(branchId) {
  return [branchId, branchId, DEFAULT_BRANCH_ID];
}

/**
 * Отчёт по статьям кассы за период — строго в рамках branchId.
 * Статьи чужого филиала не подтягиваются (JOIN по ca.branch_id).
 */
export function getCashArticlesReport(branchId = DEFAULT_BRANCH_ID, dateFrom = null, dateTo = null) {
  const bid = branchId || DEFAULT_BRANCH_ID;
  // Порядок плейсхолдеров: JOIN ca.branch_id, затем фильтр payments.branch_id
  const params = [bid, ...paymentsBranchFilterParams(bid)];
  const dateFilter = buildDateFilter('p.date', dateFrom, dateTo, params);

  const rows = queryAll(`
    SELECT
      ca.id AS article_id,
      ca.code AS code,
      ca.name AS article_name,
      ca.direction AS article_direction,
      p.type AS payment_type,
      COUNT(*) AS ops_count,
      COALESCE(SUM(p.amount), 0) AS amount
    FROM payments p
    LEFT JOIN cash_articles ca
      ON ca.id = p.article_id
     AND ca.branch_id = ?
    WHERE ${paymentsBranchFilterSql('p')}
    ${dateFilter}
    GROUP BY ca.id, ca.code, ca.name, ca.direction, p.type
    ORDER BY amount DESC
  `, params);

  const incomeMap = new Map();
  const expenseMap = new Map();

  const bump = (map, key, row, direction) => {
    const prev = map.get(key) || {
      article_id: row.article_id || null,
      code: row.code || null,
      name: row.article_name || 'Без статьи',
      direction,
      ops_count: 0,
      amount: 0,
    };
    prev.ops_count += Number(row.ops_count) || 0;
    prev.amount += Number(row.amount) || 0;
    map.set(key, prev);
  };

  for (const row of rows) {
    let direction = row.article_direction;
    if (direction !== 'income' && direction !== 'expense') {
      direction = (row.payment_type === 'customer_income' || row.payment_type === 'other_income')
        ? 'income'
        : 'expense';
    }
    const key = row.article_id || `__none__:${direction}:${row.payment_type || ''}`;
    bump(direction === 'income' ? incomeMap : expenseMap, key, row, direction);
  }

  const sortItems = (items) => items.sort((a, b) => (b.amount - a.amount)
    || String(a.name).localeCompare(String(b.name), 'ru'));

  const incomeItems = sortItems([...incomeMap.values()]);
  const expenseItems = sortItems([...expenseMap.values()]);

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    branch_id: bid,
    income: {
      total: incomeItems.reduce((s, r) => s + r.amount, 0),
      ops_count: incomeItems.reduce((s, r) => s + r.ops_count, 0),
      items: incomeItems,
    },
    expense: {
      total: expenseItems.reduce((s, r) => s + r.amount, 0),
      ops_count: expenseItems.reduce((s, r) => s + r.ops_count, 0),
      items: expenseItems,
    },
  };
}

export function getPnLReport(branchId = DEFAULT_BRANCH_ID, dateFrom = null, dateTo = null) {
  const docParams = [branchId];
  const docDateFilter = buildDateFilter('d.date', dateFrom, dateTo, docParams);
  const excludeMyShopSales = `
    AND NOT EXISTS (SELECT 1 FROM shop_orders so WHERE so.document_id = d.id)
  `;

  const salesRow = queryOne(`
    SELECT COALESCE(SUM(d.total_amount), 0) as total, COUNT(*) as doc_count
    FROM documents d
    WHERE d.type = 'rashod' AND d.status = 'confirmed' AND d.branch_id = ?
    ${excludeMyShopSales}
    ${docDateFilter}
  `, docParams);

  const dishParams = [branchId];
  const dishDateFilter = buildDateFilter('d.date', dateFrom, dateTo, dishParams);
  const dishSalesRow = queryOne(`
    SELECT COALESCE(SUM(d.total_amount), 0) as total, COUNT(*) as doc_count
    FROM documents d
    WHERE d.type = 'dish_sale' AND d.status = 'confirmed' AND d.branch_id = ?
    ${dishDateFilter}
  `, dishParams);

  const returnParams = [branchId];
  const returnDateFilter = buildDateFilter('d.date', dateFrom, dateTo, returnParams);
  const returnsRow = queryOne(`
    SELECT COALESCE(SUM(d.total_amount), 0) as total, COUNT(*) as doc_count
    FROM documents d
    WHERE d.type = 'return_customer' AND d.status = 'confirmed' AND d.branch_id = ?
    ${returnDateFilter}
  `, returnParams);

  const cogsParams = [branchId];
  const cogsDateFilter = buildDateFilter('d.date', dateFrom, dateTo, cogsParams);
  const cogsSalesRow = queryOne(`
    SELECT COALESCE(SUM(di.cost_amount), 0) as total,
      SUM(CASE WHEN COALESCE(di.cost_amount, 0) = 0 AND di.amount > 0 THEN 1 ELSE 0 END) as missing_cost_lines
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    WHERE d.type = 'rashod' AND d.status = 'confirmed' AND d.branch_id = ?
    ${excludeMyShopSales}
    ${cogsDateFilter}
  `, cogsParams);

  const cogsReturnParams = [branchId];
  const cogsReturnDateFilter = buildDateFilter('d.date', dateFrom, dateTo, cogsReturnParams);
  const cogsReturnsRow = queryOne(`
    SELECT COALESCE(SUM(di.cost_amount), 0) as total
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    WHERE d.type = 'return_customer' AND d.status = 'confirmed' AND d.branch_id = ?
    ${cogsReturnDateFilter}
  `, cogsReturnParams);

  const cogsDishParams = [branchId];
  const cogsDishDateFilter = buildDateFilter('d.date', dateFrom, dateTo, cogsDishParams);
  const cogsDishRow = queryOne(`
    SELECT COALESCE(SUM(di.cost_amount), 0) as total
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    WHERE d.type = 'dish_sale' AND d.status = 'confirmed' AND d.branch_id = ?
      AND di.item_role = 'sale'
    ${cogsDishDateFilter}
  `, cogsDishParams);

  const categoryParams = [branchId];
  const categoryDateFilter = buildDateFilter('d.date', dateFrom, dateTo, categoryParams);
  const categoryRows = queryAll(`
    SELECT
      COALESCE(pc.id, '') as category_id,
      COALESCE(pc.name, 'Без категории') as category_name,
      COALESCE(SUM(CASE
        WHEN d.type = 'rashod' THEN di.amount
        WHEN d.type = 'dish_sale' AND di.item_role = 'sale' THEN di.amount
        ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN d.type = 'return_customer' THEN di.amount ELSE 0 END), 0) as revenue,
      COALESCE(SUM(CASE
        WHEN d.type = 'rashod' THEN di.cost_amount
        WHEN d.type = 'dish_sale' AND di.item_role = 'sale' THEN di.cost_amount
        ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN d.type = 'return_customer' THEN di.cost_amount ELSE 0 END), 0) as cogs
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    JOIN products p ON p.id = di.product_id
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    WHERE d.status = 'confirmed'
      AND d.branch_id = ?
      AND (
        d.type IN ('return_customer', 'dish_sale')
        OR (d.type = 'rashod' AND NOT EXISTS (SELECT 1 FROM shop_orders so WHERE so.document_id = d.id))
      )
      AND (d.type != 'dish_sale' OR di.item_role = 'sale')
    ${categoryDateFilter}
    GROUP BY pc.id, pc.name
    HAVING ABS(
      COALESCE(SUM(CASE
        WHEN d.type = 'rashod' THEN di.amount
        WHEN d.type = 'dish_sale' AND di.item_role = 'sale' THEN di.amount
        ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN d.type = 'return_customer' THEN di.amount ELSE 0 END), 0)
    ) > 0.005 OR ABS(
      COALESCE(SUM(CASE
        WHEN d.type = 'rashod' THEN di.cost_amount
        WHEN d.type = 'dish_sale' AND di.item_role = 'sale' THEN di.cost_amount
        ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN d.type = 'return_customer' THEN di.cost_amount ELSE 0 END), 0)
    ) > 0.005
    ORDER BY 3 DESC, category_name ASC
  `, categoryParams);

  const monthParams = [branchId];
  const monthDateFilter = buildDateFilter('d.date', dateFrom, dateTo, monthParams);
  const monthRows = queryAll(`
    SELECT
      strftime('%Y-%m', d.date) as month,
      COALESCE(SUM(CASE WHEN d.type = 'rashod' THEN d.total_amount ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN d.type = 'dish_sale' THEN d.total_amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN d.type = 'return_customer' THEN d.total_amount ELSE 0 END), 0) as revenue,
      COALESCE(SUM(CASE WHEN d.type = 'rashod' THEN di.cost_amount ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN d.type = 'dish_sale' AND di.item_role = 'sale' THEN di.cost_amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN d.type = 'return_customer' THEN di.cost_amount ELSE 0 END), 0) as cogs
    FROM documents d
    LEFT JOIN document_items di ON di.document_id = d.id
      AND (d.type != 'dish_sale' OR di.item_role = 'sale' OR di.item_role IS NULL)
    WHERE d.status = 'confirmed'
      AND d.branch_id = ?
      AND (
        d.type IN ('return_customer', 'dish_sale')
        OR (d.type = 'rashod' AND NOT EXISTS (SELECT 1 FROM shop_orders so WHERE so.document_id = d.id))
      )
    ${monthDateFilter}
    GROUP BY 1
    ORDER BY 1 ASC
  `, monthParams);

  const payParams = [branchId, ...paymentsBranchFilterParams(branchId)];
  const payDateFilter = buildDateFilter('p.date', dateFrom, dateTo, payParams);

  const expenseRows = queryAll(`
    SELECT ca.code, ca.name, COALESCE(SUM(p.amount), 0) as amount
    FROM payments p
    LEFT JOIN cash_articles ca ON ca.id = p.article_id AND ca.branch_id = ?
    WHERE ${paymentsBranchFilterSql('p')} AND p.type = 'other_expense'
    ${payDateFilter}
      AND (ca.code IS NULL OR ca.code != ?)
    GROUP BY ca.id, ca.code, ca.name
    ORDER BY amount DESC, ca.name ASC
  `, [...payParams, PURCHASE_ARTICLE_CODE]);

  const incomeRows = queryAll(`
    SELECT ca.code, ca.name, COALESCE(SUM(p.amount), 0) as amount
    FROM payments p
    LEFT JOIN cash_articles ca ON ca.id = p.article_id AND ca.branch_id = ?
    WHERE ${paymentsBranchFilterSql('p')} AND p.type = 'other_income'
    ${payDateFilter}
    GROUP BY ca.id, ca.code, ca.name
    ORDER BY amount DESC, ca.name ASC
  `, payParams);

  const invParams = [branchId];
  const invDateFilter = buildDateFilter('d.date', dateFrom, dateTo, invParams);
  const inventoryRow = queryOne(`
    SELECT
      COALESCE(SUM(CASE
        WHEN (CASE WHEN COALESCE(di.net_weight, 0) > 0 THEN di.net_weight * di.quantity ELSE di.quantity END)
             < COALESCE(di.book_qty, 0) THEN COALESCE(di.cost_amount, 0)
        ELSE 0 END), 0) as shortage,
      COALESCE(SUM(CASE
        WHEN (CASE WHEN COALESCE(di.net_weight, 0) > 0 THEN di.net_weight * di.quantity ELSE di.quantity END)
             > COALESCE(di.book_qty, 0) THEN COALESCE(di.cost_amount, 0)
        ELSE 0 END), 0) as surplus
    FROM documents d
    JOIN document_items di ON di.document_id = d.id
    WHERE d.type = 'inventory' AND d.status = 'confirmed' AND d.branch_id = ?
      AND COALESCE(d.inventory_coverage, 'partial') != 'remainder'
    ${invDateFilter}
  `, invParams);
  const inventoryShortage = Number(inventoryRow?.shortage) || 0;
  const inventorySurplus = Number(inventoryRow?.surplus) || 0;

  const remainderParams = [branchId];
  const remainderDateFilter = buildDateFilter('d.date', dateFrom, dateTo, remainderParams);
  const remainderRows = queryAll(`
    SELECT ca.id as article_id, ca.code, COALESCE(ca.name, 'Недостача') as name,
           COALESCE(SUM(di.cost_amount), 0) as amount
    FROM documents d
    JOIN document_items di ON di.document_id = d.id
    LEFT JOIN cash_articles ca ON ca.id = d.article_id
    WHERE d.type = 'inventory' AND d.status = 'confirmed' AND d.branch_id = ?
      AND d.inventory_coverage = 'remainder'
      AND di.quantity < COALESCE(di.book_qty, 0)
    ${remainderDateFilter}
    GROUP BY ca.id, ca.code, ca.name
    ORDER BY amount DESC, ca.name ASC
  `, remainderParams);
  const remainderShortage = remainderRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const sales = (salesRow?.total || 0) + (dishSalesRow?.total || 0);
  const returns = returnsRow?.total || 0;
  const revenue = sales - returns;
  const cogs = (cogsSalesRow?.total || 0) + (cogsDishRow?.total || 0) - (cogsReturnsRow?.total || 0);
  const grossProfit = revenue - cogs;
  const grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0;
  const operatingExpenses = expenseRows.reduce((s, r) => s + (r.amount || 0), 0)
    + inventoryShortage + remainderShortage;
  const otherIncome = incomeRows.reduce((s, r) => s + (r.amount || 0), 0) + inventorySurplus;
  const netProfit = grossProfit - operatingExpenses + otherIncome;
  const missingCostLines = cogsSalesRow?.missing_cost_lines || 0;

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    method: 'accrual',
    revenue: {
      sales: salesRow?.total || 0,
      dishes: dishSalesRow?.total || 0,
      returns,
      doc_count: (salesRow?.doc_count || 0) + (dishSalesRow?.doc_count || 0),
      rashod_doc_count: salesRow?.doc_count || 0,
      dish_doc_count: dishSalesRow?.doc_count || 0,
      return_doc_count: returnsRow?.doc_count || 0,
      total: revenue,
    },
    cogs: {
      total: cogs,
      missing_cost_lines: missingCostLines,
    },
    gross_profit: grossProfit,
    gross_margin_pct: grossMarginPct,
    operating_expenses: {
      total: operatingExpenses,
      items: [
        ...expenseRows.map((r) => ({
          code: r.code || null,
          name: r.name || 'Без статьи',
          amount: r.amount || 0,
        })),
        ...remainderRows
          .filter((r) => (Number(r.amount) || 0) > 0)
          .map((r) => ({
            code: r.code || 'exp_shortage',
            name: r.name || 'Недостача',
            amount: Number(r.amount) || 0,
            source: 'inventory_remainder',
          })),
        ...(inventoryShortage > 0
          ? [{ code: 'inventory', name: 'Инвентаризация', amount: inventoryShortage, source: 'inventory' }]
          : []),
      ],
    },
    other_income: {
      total: otherIncome,
      items: [
        ...incomeRows.map((r) => ({
          code: r.code || null,
          name: r.name || 'Без статьи',
          amount: r.amount || 0,
        })),
        ...(inventorySurplus > 0
          ? [{ code: 'inventory', name: 'Инвентаризация', amount: inventorySurplus, source: 'inventory' }]
          : []),
      ],
    },
    by_category: categoryRows.map((row) => ({
      category_id: row.category_id || null,
      category_name: row.category_name,
      revenue: row.revenue || 0,
      cogs: row.cogs || 0,
      gross_profit: (row.revenue || 0) - (row.cogs || 0),
    })),
    by_month: monthRows.map((row) => ({
      month: row.month,
      revenue: row.revenue || 0,
      cogs: row.cogs || 0,
      gross_profit: (row.revenue || 0) - (row.cogs || 0),
    })),
    net_profit: netProfit,
    net_margin_pct: revenue > 0 ? Math.round((netProfit / revenue) * 10000) / 100 : 0,
    notes: missingCostLines > 0
      ? 'Часть продаж без сохранённой себестоимости (старые документы). COGS может быть занижен.'
      : null,
  };
}
