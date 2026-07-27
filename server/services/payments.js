import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { hasPermission } from '../permissions.js';
import { assertCounterpartyBranch, DEFAULT_CONTRACT_ID } from './counterparties.js';
import {
  getCashArticles,
  getCashArticlesAll,
  createCashArticle,
  updateCashArticle,
  deleteCashArticle,
  assertCashArticleForPayment,
  isPurchaseArticleId,
  isClientDebtArticleId,
  isDebtReturnArticleId,
} from '../cashArticles.js';
import { getConfirmedOpeningTotals } from './openingBalanceDocuments.js';
import { assertBankAccountInBranch } from './bankAccounts.js';

export {
  getCashArticles,
  getCashArticlesAll,
  createCashArticle,
  updateCashArticle,
  deleteCashArticle,
};

const INCOME_TYPES = ['customer_income', 'other_income'];
const EXPENSE_TYPES = ['supplier_payment', 'other_expense'];

const { queryAll, queryOne, run } = db;

function branchPaymentFilterSql(alias = '') {
  const col = alias ? `${alias}.` : '';
  return `(${col}branch_id = ? OR (${col}branch_id IS NULL AND ? = ?))`;
}

function sumPaymentsForRange(branchId, { beforeDate = null, onDate = null } = {}) {
  const opening = getConfirmedOpeningTotals(branchId);
  const params = [
    ...INCOME_TYPES,
    ...EXPENSE_TYPES,
    branchId,
    branchId,
    DEFAULT_BRANCH_ID,
  ];
  let dateSql = '';
  if (beforeDate) {
    dateSql = ' AND date < ?';
    params.push(beforeDate);
  } else if (onDate) {
    dateSql = ' AND date = ?';
    params.push(onDate);
  }
  if (opening.start_date && (beforeDate || onDate)) {
    const rangeStart = opening.start_date;
    const rangeEnd = beforeDate || onDate;
    if (!rangeEnd || rangeEnd > rangeStart) {
      dateSql += ' AND date >= ?';
      params.push(rangeStart);
    }
  }

  const row = queryOne(
    `SELECT
      COALESCE(SUM(CASE WHEN type IN (${INCOME_TYPES.map(() => '?').join(',')}) THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN type IN (${EXPENSE_TYPES.map(() => '?').join(',')}) THEN amount ELSE 0 END), 0) as expense
     FROM payments
     WHERE ${branchPaymentFilterSql()}
     ${dateSql}`,
    params,
  );
  return {
    income: row?.income || 0,
    expense: row?.expense || 0,
    net: (row?.income || 0) - (row?.expense || 0),
  };
}

export function getCashShiftSummary(branchId = DEFAULT_BRANCH_ID, shiftDate) {
  if (!shiftDate) throw new Error('Укажите дату смены');
  const opening = getConfirmedOpeningTotals(branchId);
  const before = sumPaymentsForRange(branchId, { beforeDate: shiftDate });
  const day = sumPaymentsForRange(branchId, { onDate: shiftDate });
  const openingBalance = (opening.cash || 0) + before.net;
  const closingBalance = openingBalance + day.income - day.expense;

  return {
    date: shiftDate,
    opening_balance: openingBalance,
    income: day.income,
    expense: day.expense,
    closing_balance: closingBalance,
  };
}

function generatePaymentNumber(branchId = DEFAULT_BRANCH_ID) {
  const branchPrefix = (branchId || DEFAULT_BRANCH_ID).slice(0, 4).toUpperCase();
  const rows = queryAll(
    'SELECT number FROM payments WHERE branch_id = ? OR (branch_id IS NULL AND ? = ?)',
    [branchId, branchId, DEFAULT_BRANCH_ID],
  );
  let max = 0;
  for (const row of rows) {
    // Strip branch prefix if present (e.g. "MAIN-42" → 42)
    const raw = String(row.number || '').replace(/^[A-Z0-9]+-/, '');
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${branchPrefix}-${max + 1}`;
}

const CASHIER_VIEW_DAYS = 3;

export function getPayments(branchId = null, userRole = null, filters = {}) {
  let sql = `
    SELECT p.*, c.name as counterparty_name, c.type as counterparty_type,
           d.number as document_number, u.name as created_by_name,
           b.name as branch_name, ca.name as article_name, ca.code as article_code,
           ca.direction as article_direction,
           cc.number as contract_number,
           cf.name as firm_name, cf.inn as firm_inn
    FROM payments p
    LEFT JOIN counterparties c ON c.id = p.counterparty_id
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN cash_articles ca ON ca.id = p.article_id
      AND (ca.branch_id = p.branch_id OR (p.branch_id IS NULL AND ca.branch_id = '${DEFAULT_BRANCH_ID}'))
    LEFT JOIN counterparty_contracts cc ON cc.id = p.contract_id
    LEFT JOIN counterparty_firms cf ON cf.id = p.firm_id
  `;
  const params = [];
  const conditions = [];

  if (branchId) {
    conditions.push('(p.branch_id = ? OR (p.branch_id IS NULL AND ? = ?))');
    params.push(branchId, branchId, DEFAULT_BRANCH_ID);
  }

  // Enforce cashier date window server-side
  const canViewAll = !userRole
    || hasPermission(userRole, 'cashier.edit_past')
    || hasPermission(userRole, 'payments.edit_past')
    || hasPermission(userRole, 'payments.view');
  if (!canViewAll) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CASHIER_VIEW_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    conditions.push('p.date >= ?');
    params.push(cutoffStr);
  }

  if (filters.date_from) {
    conditions.push('p.date >= ?');
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push('p.date <= ?');
    params.push(filters.date_to);
  }
  if (filters.type) {
    conditions.push('p.type = ?');
    params.push(filters.type);
  }
  if (filters.bank_account_id) {
    conditions.push('p.bank_account_id = ?');
    params.push(filters.bank_account_id);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY p.date DESC, p.created_at DESC';

  const rows = queryAll(sql, params);

  // Pagination
  const limit = filters.limit ? parseInt(filters.limit, 10) : 0;
  const page = filters.page ? parseInt(filters.page, 10) : 1;
  if (limit > 0) {
    const total = rows.length;
    const offset = (page - 1) * limit;
    return {
      items: rows.slice(offset, offset + limit),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }
  return rows;
}

function paymentTodayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function assertPaymentShiftAccess(userRole, ...dates) {
  if (!userRole || hasPermission(userRole, 'payments.edit_past') || hasPermission(userRole, 'cashier.edit_past')) return;
  const today = paymentTodayIso();
  for (const date of dates) {
    if (date && date !== today) {
      throw new Error('Нельзя изменять операции за прошлые даты');
    }
  }
}

function assertPurchasePayment(data, payBranchId) {
  if (!isPurchaseArticleId(data.article_id)) return;
  if (!data.counterparty_id) throw new Error('Выберите поставщика');
  if (data.type !== 'supplier_payment') throw new Error('Для статьи «Закуп» нужна оплата поставщику');
  assertCounterpartyBranch(data.counterparty_id, payBranchId, 'prihod');
}

function assertClientDebtPayment(data, payBranchId) {
  if (!isClientDebtArticleId(data.article_id)) return;
  if (!data.counterparty_id) throw new Error('Выберите клиента');
  if (data.type !== 'other_expense') throw new Error('Для статьи «Долг клиентам» нужен расход с клиентом');
  const cp = queryOne('SELECT id, type FROM counterparties WHERE id = ?', [data.counterparty_id]);
  if (!cp) throw new Error('Клиент не найден');
  if (cp.type !== 'client') throw new Error('Укажите клиента');
  assertCounterpartyBranch(data.counterparty_id, payBranchId);
}

function assertDebtReturnPayment(data, payBranchId) {
  if (!isDebtReturnArticleId(data.article_id)) return;
  if (!data.counterparty_id) throw new Error('Выберите клиента');
  if (data.type !== 'customer_income') throw new Error('Для статьи «Возврат долга» нужен приход от клиента');
  const cp = queryOne('SELECT id, type FROM counterparties WHERE id = ?', [data.counterparty_id]);
  if (!cp) throw new Error('Клиент не найден');
  if (cp.type !== 'client') throw new Error('Укажите клиента');
  assertCounterpartyBranch(data.counterparty_id, payBranchId, 'rashod');
}

function assertPaymentBranchAccess(paymentBranchId, requestedBranchId) {
  if (!requestedBranchId) return;
  if (paymentBranchId && paymentBranchId !== requestedBranchId) {
    throw new Error('Оплата принадлежит другому филиалу');
  }
}

function assertPaymentDocumentLink(documentId, paymentType, payBranchId, counterpartyId = null) {
  if (!documentId) return null;
  const doc = queryOne(
    'SELECT id, type, status, branch_id, counterparty_id FROM documents WHERE id = ?',
    [documentId],
  );
  if (!doc) throw new Error('Связанный документ не найден');
  if (doc.status !== 'confirmed') {
    throw new Error('Привязать оплату можно только к проведённому документу');
  }
  if (doc.type !== 'prihod' && doc.type !== 'rashod') {
    throw new Error('Оплаты можно привязывать только к документам прихода/расхода');
  }
  if (doc.branch_id !== payBranchId) {
    throw new Error('Документ принадлежит другому филиалу');
  }
  if (paymentType === 'supplier_payment' && doc.type !== 'prihod') {
    throw new Error('Оплата поставщику привязывается только к документу прихода');
  }
  if (paymentType === 'customer_income' && doc.type !== 'rashod') {
    throw new Error('Оплата от клиента привязывается только к документу расхода');
  }
  if (paymentType === 'other_income' || paymentType === 'other_expense') {
    throw new Error('Для прочих операций не указывайте связанный документ');
  }
  if (counterpartyId && doc.counterparty_id && counterpartyId !== doc.counterparty_id) {
    throw new Error('Контрагент оплаты не совпадает с контрагентом документа');
  }
  return doc;
}

function assertPaymentContractLink(contractId, counterpartyId, payBranchId) {
  if (!contractId) return;
  if (contractId === DEFAULT_CONTRACT_ID) return;
  if (!counterpartyId) throw new Error('Договор можно указать только вместе с контрагентом');
  const row = queryOne(
    'SELECT id FROM counterparty_contracts WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [contractId, counterpartyId, payBranchId],
  );
  if (!row) throw new Error('Договор не найден у выбранного контрагента');
}

function assertPaymentFirmLink(firmId, counterpartyId, payBranchId) {
  if (!firmId) return;
  if (!counterpartyId) throw new Error('Фирма указывается вместе с контрагентом');
  const row = queryOne(
    'SELECT id FROM counterparty_firms WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [firmId, counterpartyId, payBranchId],
  );
  if (!row) throw new Error('Фирма не найдена у выбранного контрагента');
}

export function createPayment(data, userId = null, branchId = DEFAULT_BRANCH_ID, userRole = null) {
  const id = uuidv4();
  const payBranchId = branchId || data.branch_id || DEFAULT_BRANCH_ID;
  if (branchId && data.branch_id && data.branch_id !== branchId) {
    throw new Error('Нет доступа к выбранному филиалу');
  }
  const number = data.number || generatePaymentNumber(payBranchId);
  const amount = Math.round(Number(data.amount) || 0);
  if (!amount || amount <= 0) throw new Error('Укажите сумму больше нуля');
  assertPaymentShiftAccess(userRole, data.date);
  assertCashArticleForPayment(data.article_id, data.type, payBranchId);
  assertPurchasePayment(data, payBranchId);
  assertClientDebtPayment(data, payBranchId);
  assertDebtReturnPayment(data, payBranchId);
  assertPaymentDocumentLink(data.document_id || null, data.type, payBranchId, data.counterparty_id || null);
  assertPaymentContractLink(data.contract_id || null, data.counterparty_id || null, payBranchId);
  assertPaymentFirmLink(data.firm_id || null, data.counterparty_id || null, payBranchId);
  if (data.bank_account_id) {
    assertBankAccountInBranch(data.bank_account_id, payBranchId);
  }

  if (data.counterparty_id) {
    let typeCheck = null;
    if (data.type === 'supplier_payment') typeCheck = 'prihod';
    else if (data.type === 'customer_income') typeCheck = 'rashod';
    assertCounterpartyBranch(data.counterparty_id, payBranchId, typeCheck);
  }

  if (data.external_ref) {
    const dup = queryOne(
      `SELECT id FROM payments
       WHERE external_ref = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))`,
      [data.external_ref, payBranchId, payBranchId, DEFAULT_BRANCH_ID],
    );
    if (dup) throw new Error('Эта операция из выписки уже загружена');
  }

  run(`
    INSERT INTO payments (
      id, number, type, counterparty_id, document_id, amount, date, comment,
      created_by, branch_id, article_id, external_ref, import_batch_id, contract_id, firm_id,
      bank_account_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, number, data.type, data.counterparty_id || null, data.document_id || null,
    amount, data.date, data.comment || '', userId, payBranchId, data.article_id,
    data.external_ref || null, data.import_batch_id || null, data.contract_id || null,
    data.firm_id || null, data.bank_account_id || null,
  ]);

  return queryOne(`
    SELECT p.*, c.name as counterparty_name, d.number as document_number, ca.name as article_name,
           ca.code as article_code, cc.number as contract_number,
           cf.name as firm_name, cf.inn as firm_inn
    FROM payments p
    LEFT JOIN counterparties c ON c.id = p.counterparty_id
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN cash_articles ca ON ca.id = p.article_id
      AND (ca.branch_id = p.branch_id OR (p.branch_id IS NULL AND ca.branch_id = '${DEFAULT_BRANCH_ID}'))
    LEFT JOIN counterparty_contracts cc ON cc.id = p.contract_id
    LEFT JOIN counterparty_firms cf ON cf.id = p.firm_id
    WHERE p.id = ?
  `, [id]);
}

export function updatePayment(id, data, branchId = DEFAULT_BRANCH_ID, userRole = null) {
  const existing = queryOne('SELECT * FROM payments WHERE id = ?', [id]);
  if (!existing) throw new Error('Оплата не найдена');
  assertPaymentBranchAccess(existing.branch_id || DEFAULT_BRANCH_ID, branchId);
  if (data.branch_id && data.branch_id !== (existing.branch_id || branchId)) {
    throw new Error('Нельзя изменить филиал оплаты');
  }

  const newDate = data.date || existing.date;
  assertPaymentShiftAccess(userRole, existing.date, newDate);

  const counterpartyId = data.counterparty_id !== undefined
    ? data.counterparty_id
    : existing.counterparty_id;
  const payBranchId = existing.branch_id || branchId;
  const payType = data.type || existing.type;
  const articleId = data.article_id ?? existing.article_id;
  const documentId = data.document_id !== undefined ? data.document_id : existing.document_id;
  const contractId = data.contract_id !== undefined ? data.contract_id : existing.contract_id;
  const firmId = data.firm_id !== undefined ? data.firm_id : existing.firm_id;
  const bankAccountId = data.bank_account_id !== undefined
    ? data.bank_account_id
    : existing.bank_account_id;
  assertCashArticleForPayment(articleId, payType, payBranchId);
  assertPurchasePayment({ ...data, article_id: articleId, type: payType, counterparty_id: counterpartyId }, payBranchId);
  assertClientDebtPayment({ ...data, article_id: articleId, type: payType, counterparty_id: counterpartyId }, payBranchId);
  assertDebtReturnPayment({ ...data, article_id: articleId, type: payType, counterparty_id: counterpartyId }, payBranchId);
  assertPaymentDocumentLink(documentId, payType, payBranchId, counterpartyId);
  assertPaymentContractLink(contractId, counterpartyId, payBranchId);
  assertPaymentFirmLink(firmId, counterpartyId, payBranchId);
  if (bankAccountId) {
    assertBankAccountInBranch(bankAccountId, payBranchId);
  }
  if (counterpartyId) {
    let typeCheck = null;
    if (payType === 'supplier_payment') typeCheck = 'prihod';
    else if (payType === 'customer_income') typeCheck = 'rashod';
    assertCounterpartyBranch(counterpartyId, payBranchId, typeCheck);
  }

  run(`
    UPDATE payments
    SET type=?, counterparty_id=?, document_id=?, amount=?, date=?, comment=?, article_id=?, contract_id=?, firm_id=?, bank_account_id=?
    WHERE id=?
  `, [
    payType,
    counterpartyId,
    documentId,
    data.amount !== undefined ? Math.round(Number(data.amount) || 0) : existing.amount,
    data.date || existing.date,
    data.comment ?? existing.comment,
    articleId,
    contractId || null,
    firmId || null,
    bankAccountId || null,
    id,
  ]);

  return queryOne(`
    SELECT p.*, c.name as counterparty_name, d.number as document_number, ca.name as article_name,
           ca.code as article_code, cc.number as contract_number,
           cf.name as firm_name, cf.inn as firm_inn
    FROM payments p
    LEFT JOIN counterparties c ON c.id = p.counterparty_id
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN cash_articles ca ON ca.id = p.article_id
      AND (ca.branch_id = p.branch_id OR (p.branch_id IS NULL AND ca.branch_id = '${DEFAULT_BRANCH_ID}'))
    LEFT JOIN counterparty_contracts cc ON cc.id = p.contract_id
    LEFT JOIN counterparty_firms cf ON cf.id = p.firm_id
    WHERE p.id = ?
  `, [id]);
}

export function deletePayment(id, userRole = null, branchId = DEFAULT_BRANCH_ID) {
  const existing = queryOne('SELECT * FROM payments WHERE id = ?', [id]);
  if (!existing) throw new Error('Оплата не найдена');
  assertPaymentBranchAccess(existing.branch_id || DEFAULT_BRANCH_ID, branchId);
  assertPaymentShiftAccess(userRole, existing.date);
  run('DELETE FROM payments WHERE id = ?', [id]);
}

/** Удалить все банковские операции за дату (выписка-день), опционально по счёту. */
export function deletePaymentsByDate(
  date,
  userRole = null,
  branchId = DEFAULT_BRANCH_ID,
  bankAccountId = null,
) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error('Укажите дату выписки (YYYY-MM-DD)');
  }
  assertPaymentShiftAccess(userRole, date);
  const params = [date, branchId, branchId, DEFAULT_BRANCH_ID];
  let accountSql = '';
  if (bankAccountId) {
    accountSql = ' AND bank_account_id = ?';
    params.push(bankAccountId);
  }
  const rows = queryAll(
    `SELECT id FROM payments
     WHERE date = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))${accountSql}`,
    params,
  );
  if (!rows.length) {
    return { ok: true, date, bank_account_id: bankAccountId || null, deleted_count: 0 };
  }
  run(
    `DELETE FROM payments
     WHERE date = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))${accountSql}`,
    params,
  );
  return {
    ok: true,
    date,
    bank_account_id: bankAccountId || null,
    deleted_count: rows.length,
  };
}