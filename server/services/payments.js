import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { hasPermission } from '../permissions.js';
import { assertCounterpartyBranch } from './counterparties.js';

const { queryAll, queryOne, run } = db;

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
    sql += ' WHERE p.branch_id = ?';
    params.push(branchId);
  }
  sql += ' ORDER BY p.date DESC, p.created_at DESC';
  return queryAll(sql, params);
}

export function getCashArticles(direction = null) {
  let sql = 'SELECT id, name, direction, sort_order FROM cash_articles WHERE active = 1';
  const params = [];
  if (direction) {
    sql += ' AND direction = ?';
    params.push(direction);
  }
  sql += ' ORDER BY sort_order, name';
  return queryAll(sql, params);
}

const PURCHASE_ARTICLE_ID = 'ca_exp_purchase';

export function getCashArticlesAll() {
  return queryAll(`
    SELECT ca.*,
      (SELECT COUNT(*) FROM payments p WHERE p.article_id = ca.id) AS usage_count
    FROM cash_articles ca
    ORDER BY ca.direction, ca.sort_order, ca.name
  `);
}

export function createCashArticle(data) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Укажите название статьи');
  if (!['income', 'expense'].includes(data.direction)) {
    throw new Error('Укажите направление: приход или расход');
  }
  const id = uuidv4();
  const sortOrder = Number.isFinite(Number(data.sort_order)) ? Number(data.sort_order) : 0;
  const active = data.active === false ? 0 : 1;
  run(
    'INSERT INTO cash_articles (id, name, direction, sort_order, active) VALUES (?, ?, ?, ?, ?)',
    [id, name, data.direction, sortOrder, active],
  );
  return queryOne('SELECT *, 0 AS usage_count FROM cash_articles WHERE id = ?', [id]);
}

export function updateCashArticle(id, data) {
  const existing = queryOne('SELECT * FROM cash_articles WHERE id = ?', [id]);
  if (!existing) throw new Error('Статья не найдена');

  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!name) throw new Error('Укажите название статьи');

  let direction = data.direction ?? existing.direction;
  if (id === PURCHASE_ARTICLE_ID && direction !== 'expense') {
    throw new Error('Статья «Закуп» должна оставаться расходом');
  }
  if (!['income', 'expense'].includes(direction)) {
    throw new Error('Неверное направление');
  }

  const sortOrder = data.sort_order !== undefined
    ? Number(data.sort_order)
    : existing.sort_order;
  const active = data.active !== undefined ? (data.active ? 1 : 0) : existing.active;

  if (id === PURCHASE_ARTICLE_ID && !active) {
    throw new Error('Статью «Закуп» нельзя отключить');
  }

  run(
    'UPDATE cash_articles SET name = ?, direction = ?, sort_order = ?, active = ? WHERE id = ?',
    [name, direction, sortOrder, active, id],
  );

  return queryOne(`
    SELECT ca.*,
      (SELECT COUNT(*) FROM payments p WHERE p.article_id = ca.id) AS usage_count
    FROM cash_articles ca
    WHERE ca.id = ?
  `, [id]);
}

export function deleteCashArticle(id) {
  if (id === PURCHASE_ARTICLE_ID) {
    throw new Error('Системную статью «Закуп» нельзя удалить');
  }
  const existing = queryOne('SELECT * FROM cash_articles WHERE id = ?', [id]);
  if (!existing) throw new Error('Статья не найдена');

  const usage = queryOne('SELECT COUNT(*) AS c FROM payments WHERE article_id = ?', [id]).c;
  if (usage > 0) {
    run('UPDATE cash_articles SET active = 0 WHERE id = ?', [id]);
    return { deactivated: true };
  }

  run('DELETE FROM cash_articles WHERE id = ?', [id]);
  return { deactivated: false };
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

function assertCashArticle(articleId, paymentType) {
  if (!articleId) return null;
  const article = queryOne('SELECT * FROM cash_articles WHERE id = ? AND active = 1', [articleId]);
  if (!article) throw new Error('Статья не найдена');
  const isIncome = paymentType === 'other_income' || paymentType === 'customer_income';
  if (isIncome && article.direction !== 'income') throw new Error('Статья не подходит для прихода');
  if (!isIncome && article.direction !== 'expense') throw new Error('Статья не подходит для расхода');
  return article;
}

function assertPurchasePayment(data, payBranchId) {
  if (data.article_id !== PURCHASE_ARTICLE_ID) return;
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
  assertCashArticle(data.article_id, data.type);
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
  assertCashArticle(articleId, payType);
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