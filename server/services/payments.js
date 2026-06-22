import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { hasPermission } from '../permissions.js';
import { assertCounterpartyBranch } from './counterparties.js';
import {
  getCashArticles,
  getCashArticlesAll,
  createCashArticle,
  updateCashArticle,
  deleteCashArticle,
  assertCashArticleForPayment,
  isPurchaseArticleId,
} from '../cashArticles.js';
import { getConfirmedOpeningTotals } from './openingBalanceDocuments.js';

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
  const rows = queryAll('SELECT number FROM payments WHERE branch_id = ? OR (branch_id IS NULL AND ? = ?)', [branchId, branchId, DEFAULT_BRANCH_ID]);
  let max = 0;
  for (const row of rows) {
    const n = parseInt(row.number, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

export function getPayments(branchId = null) {
  let sql = `
    SELECT p.*, c.name as counterparty_name, c.type as counterparty_type,
           d.number as document_number, u.name as created_by_name,
           b.name as branch_name, ca.name as article_name, ca.direction as article_direction
    FROM payments p
    LEFT JOIN counterparties c ON c.id = p.counterparty_id
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN cash_articles ca ON ca.id = p.article_id
  `;
  const params = [];
  if (branchId) {
    sql += ' WHERE (p.branch_id = ? OR (p.branch_id IS NULL AND ? = ?))';
    params.push(branchId, branchId, DEFAULT_BRANCH_ID);
  }
  sql += ' ORDER BY p.date DESC, p.created_at DESC';
  return queryAll(sql, params);
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

export function createPayment(data, userId = null, branchId = DEFAULT_BRANCH_ID, userRole = null) {
  const id = uuidv4();
  const payBranchId = branchId || data.branch_id || DEFAULT_BRANCH_ID;
  if (branchId && data.branch_id && data.branch_id !== branchId) {
    throw new Error('Нет доступа к выбранному филиалу');
  }
  const number = data.number || generatePaymentNumber(payBranchId);
  if (!data.amount || data.amount <= 0) throw new Error('Укажите сумму больше нуля');
  assertPaymentShiftAccess(userRole, data.date);
  assertCashArticleForPayment(data.article_id, data.type, payBranchId);
  assertPurchasePayment(data, payBranchId);
  assertPaymentDocumentLink(data.document_id || null, data.type, payBranchId, data.counterparty_id || null);

  if (data.counterparty_id) {
    let typeCheck = null;
    if (data.type === 'supplier_payment') typeCheck = 'prihod';
    else if (data.type === 'customer_income') typeCheck = 'rashod';
    assertCounterpartyBranch(data.counterparty_id, payBranchId, typeCheck);
  }

  run(`
    INSERT INTO payments (id, number, type, counterparty_id, document_id, amount, date, comment, created_by, branch_id, article_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, number, data.type, data.counterparty_id || null, data.document_id || null,
    data.amount, data.date, data.comment || '', userId, payBranchId, data.article_id,
  ]);

  return queryOne(`
    SELECT p.*, c.name as counterparty_name, d.number as document_number, ca.name as article_name
    FROM payments p
    LEFT JOIN counterparties c ON c.id = p.counterparty_id
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN cash_articles ca ON ca.id = p.article_id
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
  assertCashArticleForPayment(articleId, payType, payBranchId);
  assertPurchasePayment({ ...data, article_id: articleId, type: payType, counterparty_id: counterpartyId }, payBranchId);
  assertPaymentDocumentLink(documentId, payType, payBranchId, counterpartyId);
  if (counterpartyId) {
    let typeCheck = null;
    if (payType === 'supplier_payment') typeCheck = 'prihod';
    else if (payType === 'customer_income') typeCheck = 'rashod';
    assertCounterpartyBranch(counterpartyId, payBranchId, typeCheck);
  }

  run(`
    UPDATE payments
    SET type=?, counterparty_id=?, document_id=?, amount=?, date=?, comment=?, article_id=?
    WHERE id=?
  `, [
    payType,
    counterpartyId,
    documentId,
    data.amount ?? existing.amount,
    data.date || existing.date,
    data.comment ?? existing.comment,
    articleId,
    id,
  ]);

  return queryOne(`
    SELECT p.*, c.name as counterparty_name, d.number as document_number, ca.name as article_name
    FROM payments p
    LEFT JOIN counterparties c ON c.id = p.counterparty_id
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN cash_articles ca ON ca.id = p.article_id
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