import db from './db.js';
import { DEFAULT_BRANCH_ID } from './branches.js';
import { getDebtorsReport, getCreditorsReport, getStockReport } from './services/reports.js';
import { getConfirmedOpeningTotals } from './services/openingBalanceDocuments.js';

const { queryOne, run } = db;

function getCashMovementsSince(branchId, asOfDate) {
  const incomeTypes = ['customer_income', 'other_income'];
  const expenseTypes = ['supplier_payment', 'other_expense'];
  const incomeParams = [branchId, ...incomeTypes];
  const expenseParams = [branchId, ...expenseTypes];
  let dateFilter = '';
  if (asOfDate) {
    dateFilter = ' AND date >= ?';
    incomeParams.push(asOfDate);
    expenseParams.push(asOfDate);
  }

  const income = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as v FROM payments
     WHERE branch_id = ? AND type IN (${incomeTypes.map(() => '?').join(',')})${dateFilter}`,
    incomeParams,
  ).v;

  const expense = queryOne(
    `SELECT COALESCE(SUM(amount), 0) as v FROM payments
     WHERE branch_id = ? AND type IN (${expenseTypes.map(() => '?').join(',')})${dateFilter}`,
    expenseParams,
  ).v;

  return { income, expense, net: income - expense };
}

export function getMoneyBalances(branchId = DEFAULT_BRANCH_ID) {
  const opening = getConfirmedOpeningTotals(branchId);
  const movements = getCashMovementsSince(branchId, opening.start_date);

  const currentCash = (opening.cash || 0) + movements.net;
  const currentBank = opening.bank || 0;

  return {
    start_date: opening.start_date,
    opening_cash: opening.cash || 0,
    opening_bank: opening.bank || 0,
    income: movements.income,
    expense: movements.expense,
    current_cash: currentCash,
    current_bank: currentBank,
    current_total: currentCash + currentBank,
  };
}

export function getBusinessBalanceSummary(branchId = DEFAULT_BRANCH_ID) {
  const opening = getConfirmedOpeningTotals(branchId);
  const stockRows = getStockReport(branchId, null, false);
  const stockValue = stockRows.reduce((s, r) => s + (r.total || 0), 0);
  const debtors = getDebtorsReport(branchId, true, true);
  const creditors = getCreditorsReport(branchId, true, true);
  const money = getMoneyBalances(branchId);

  return {
    opening_document_totals: opening,
    stock: {
      value: stockValue,
      sku_count: stockRows.filter((r) => r.stock > 0).length,
      opening_doc_value: opening.stock_value,
    },
    debtors: {
      total: debtors.total_balance,
      opening_from_docs: opening.debtors,
      count: debtors.count,
    },
    creditors: {
      total: creditors.total_balance,
      opening_from_docs: opening.creditors,
      count: creditors.count,
    },
    money,
    net_position: stockValue + debtors.total_balance - creditors.total_balance + money.current_total,
  };
}

export function initBranchOpeningBalance(branchId) {
  const existing = queryOne('SELECT branch_id FROM branch_opening_balances WHERE branch_id = ?', [branchId]);
  if (!existing) {
    run(
      'INSERT INTO branch_opening_balances (branch_id, cash_balance, notes) VALUES (?, 0, ?)',
      [branchId, ''],
    );
  }
}
