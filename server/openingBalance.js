import db from './db.js';
import { DEFAULT_BRANCH_ID, getBranch } from './branches.js';
import { assertDepartmentInBranch, getDepartments, syncBranchStockFromDepartments } from './departments.js';
import { setDepartmentStock, syncVariantCatalogStock } from './inventoryCost.js';
import { getDebtorsReport, getCreditorsReport, getStockReport } from './services/reports.js';
import { getCounterparties } from './services/counterparties.js';

const { queryOne, run, transaction } = db;

function branchSettingsRow(branchId) {
  return queryOne('SELECT * FROM branch_opening_balances WHERE branch_id = ?', [branchId]);
}

export function getBranchOpeningSettings(branchId = DEFAULT_BRANCH_ID) {
  const row = branchSettingsRow(branchId);
  return {
    branch_id: branchId,
    as_of_date: row?.as_of_date || null,
    cash_balance: row?.cash_balance || 0,
    notes: row?.notes || '',
    updated_at: row?.updated_at || null,
  };
}

export function saveBranchOpeningSettings(branchId, data) {
  if (!getBranch(branchId)) throw new Error('Филиал не найден');

  const asOfDate = data.as_of_date ? String(data.as_of_date).slice(0, 10) : null;
  if (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error('Некорректная дата начала учёта');
  }

  const cashBalance = Number(data.cash_balance);
  if (!Number.isFinite(cashBalance)) throw new Error('Укажите сумму начального остатка кассы');
  if (cashBalance < 0) throw new Error('Начальный остаток кассы не может быть отрицательным');

  const notes = String(data.notes || '').trim();
  const existing = branchSettingsRow(branchId);

  if (existing) {
    run(
      `UPDATE branch_opening_balances
       SET as_of_date = ?, cash_balance = ?, notes = ?, updated_at = datetime('now')
       WHERE branch_id = ?`,
      [asOfDate, cashBalance, notes, branchId],
    );
  } else {
    run(
      `INSERT INTO branch_opening_balances (branch_id, as_of_date, cash_balance, notes)
       VALUES (?, ?, ?, ?)`,
      [branchId, asOfDate, cashBalance, notes],
    );
  }

  return getBranchOpeningSettings(branchId);
}

function getCashMovementsSince(branchId, asOfDate) {
  const incomeTypes = ['customer_income', 'other_income'];
  const expenseTypes = ['supplier_payment', 'other_expense'];
  const params = [branchId];
  let dateFilter = '';
  if (asOfDate) {
    dateFilter = ' AND date >= ?';
    params.push(asOfDate);
  }

  const income = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as v FROM payments
     WHERE branch_id = ? AND type IN (${incomeTypes.map(() => '?').join(',')})${dateFilter}`,
    [branchId, ...incomeTypes, ...(asOfDate ? [asOfDate] : [])],
  ).v;

  const expense = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as v FROM payments
     WHERE branch_id = ? AND type IN (${expenseTypes.map(() => '?').join(',')})${dateFilter}`,
    [branchId, ...expenseTypes, ...(asOfDate ? [asOfDate] : [])],
  ).v;

  return { income, expense, net: income - expense };
}

export function getCurrentCashBalance(branchId = DEFAULT_BRANCH_ID) {
  const settings = getBranchOpeningSettings(branchId);
  const movements = getCashMovementsSince(branchId, settings.as_of_date);
  return {
    opening_cash: settings.cash_balance || 0,
    income: movements.income,
    expense: movements.expense,
    current: (settings.cash_balance || 0) + movements.net,
  };
}

export function getOpeningStockLines(branchId = DEFAULT_BRANCH_ID, departmentId = null) {
  if (!departmentId) {
    const depts = getDepartments(branchId, true);
    if (depts.length === 1) departmentId = depts[0].id;
  }
  if (!departmentId) {
    return { department_id: null, lines: [], departments: getDepartments(branchId, true) };
  }

  assertDepartmentInBranch(departmentId, branchId);
  const rows = getStockReport(branchId, departmentId, false);

  return {
    department_id: departmentId,
    departments: getDepartments(branchId, true),
    lines: rows.map((row) => {
      const parts = String(row.rowKey || '').split(':');
      const productId = parts[1] || '';
      const variantId = parts[2] || null;
      return {
        row_key: row.rowKey,
        product_id: productId,
        variant_id: variantId || null,
        name: row.name,
        unit: row.unit,
        category_name: row.category_name,
        quantity: row.stock,
        unit_cost: row.unitCost,
        total: row.total,
      };
    }),
  };
}

export function saveOpeningStock(branchId, departmentId, lines) {
  if (!departmentId) throw new Error('Выберите склад (отдел)');
  assertDepartmentInBranch(departmentId, branchId);
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Нет позиций для сохранения');

  const touchedProducts = new Set();
  const touchedVariants = new Set();

  transaction(() => {
    for (const line of lines) {
      const productId = String(line.product_id || '').trim();
      if (!productId) throw new Error('Не указан товар');

      const product = queryOne('SELECT id, has_variants FROM products WHERE id = ?', [productId]);
      if (!product) throw new Error('Товар не найден');

      const variantId = line.variant_id ? String(line.variant_id) : null;
      if (variantId) {
        const variant = queryOne(
          'SELECT id FROM product_variants WHERE id = ? AND product_id = ?',
          [variantId, productId],
        );
        if (!variant) throw new Error('Вариант товара не найден');
      } else if (product.has_variants) {
        throw new Error(`Для «${line.name || productId}» укажите вариант`);
      }

      const quantity = Number(line.quantity);
      const unitCost = Number(line.unit_cost);
      if (!Number.isFinite(quantity) || quantity < 0) {
        throw new Error('Некорректное количество');
      }
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error('Некорректная себестоимость');
      }

      setDepartmentStock(departmentId, productId, quantity, unitCost, variantId);
      touchedProducts.add(productId);
      if (variantId) touchedVariants.add(`${variantId}:${branchId}`);
    }

    for (const productId of touchedProducts) {
      syncBranchStockFromDepartments(branchId, productId);
    }
    for (const key of touchedVariants) {
      const [variantId] = key.split(':');
      syncVariantCatalogStock(variantId, branchId);
    }
  });

  return getOpeningStockLines(branchId, departmentId);
}

export function saveCounterpartyOpeningBalances(branchId, items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Нет данных для сохранения');

  transaction(() => {
    for (const item of items) {
      const id = String(item.id || '').trim();
      if (!id) continue;

      const cp = queryOne('SELECT id FROM counterparties WHERE id = ? AND branch_id = ?', [id, branchId]);
      if (!cp) throw new Error('Контрагент не найден');

      const balance = Number(item.opening_balance);
      if (!Number.isFinite(balance)) throw new Error('Некорректная сумма начального сальдо');

      run(
        'UPDATE counterparties SET opening_balance = ?, updated_at = datetime(\'now\') WHERE id = ? AND branch_id = ?',
        [balance, id, branchId],
      );
    }
  });

  return getCounterparties(null, branchId).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    phone: c.phone || '',
    opening_balance: c.opening_balance || 0,
  }));
}

export function getBusinessBalanceSummary(branchId = DEFAULT_BRANCH_ID) {
  const settings = getBranchOpeningSettings(branchId);
  const stockRows = getStockReport(branchId, null, false);
  const stockValue = stockRows.reduce((s, r) => s + (r.total || 0), 0);
  const debtors = getDebtorsReport(branchId, true, true);
  const creditors = getCreditorsReport(branchId, true, true);
  const cash = getCurrentCashBalance(branchId);

  const debtorsOpening = debtors.rows.reduce((s, r) => s + (r.opening_balance || 0), 0);
  const creditorsOpening = creditors.rows.reduce((s, r) => s + (r.opening_balance || 0), 0);

  const netPosition = stockValue + debtors.total_balance - creditors.total_balance + cash.current;

  return {
    settings,
    stock: {
      value: stockValue,
      sku_count: stockRows.filter((r) => r.stock > 0).length,
    },
    debtors: {
      total: debtors.total_balance,
      opening_total: debtorsOpening,
      count: debtors.count,
    },
    creditors: {
      total: creditors.total_balance,
      opening_total: creditorsOpening,
      count: creditors.count,
    },
    cash,
    net_position: netPosition,
  };
}

export function ensureBranchOpeningRow(branchId) {
  if (!branchSettingsRow(branchId)) {
    run(
      'INSERT INTO branch_opening_balances (branch_id, cash_balance, notes) VALUES (?, 0, ?)',
      [branchId, ''],
    );
  }
}

/** При создании филиала — пустая запись настроек */
export function initBranchOpeningBalance(branchId) {
  if (!branchSettingsRow(branchId)) {
    run(
      'INSERT INTO branch_opening_balances (branch_id, cash_balance, notes) VALUES (?, 0, ?)',
      [branchId, ''],
    );
  }
}
