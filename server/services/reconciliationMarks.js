import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const { queryAll, queryOne, run } = db;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeScopeId(value) {
  const v = value == null ? '' : String(value).trim();
  return v || null;
}

function loadMark(id) {
  return queryOne(`
    SELECT rm.*, u.name AS created_by_name
    FROM reconciliation_marks rm
    LEFT JOIN users u ON u.id = rm.created_by
    WHERE rm.id = ?
  `, [id]);
}

/** Отметки сверки контрагента; firm_id / contract_id — тот же срез, что выбран в акте (null = все). */
export function getReconciliationMarks(branchId, { counterparty_id, firm_id, contract_id } = {}) {
  if (!counterparty_id) throw new Error('Укажите контрагента');
  return queryAll(`
    SELECT rm.*, u.name AS created_by_name
    FROM reconciliation_marks rm
    LEFT JOIN users u ON u.id = rm.created_by
    WHERE rm.branch_id = ? AND rm.counterparty_id = ?
      AND rm.firm_id IS ? AND rm.contract_id IS ?
    ORDER BY rm.date DESC, rm.created_at DESC
  `, [branchId, counterparty_id, normalizeScopeId(firm_id), normalizeScopeId(contract_id)]);
}

export function createReconciliationMark(branchId, data, userId) {
  const counterpartyId = normalizeScopeId(data?.counterparty_id);
  if (!counterpartyId) throw new Error('Укажите контрагента');
  const cp = queryOne('SELECT id, branch_id FROM counterparties WHERE id = ?', [counterpartyId]);
  if (!cp || cp.branch_id !== branchId) throw new Error('Нет доступа к контрагенту этого филиала');
  const date = String(data?.date || '').trim();
  if (!DATE_RE.test(date)) throw new Error('Укажите дату сверки');
  const balance = Number(data?.balance);
  if (!Number.isFinite(balance)) throw new Error('Некорректное сальдо');
  const comment = String(data?.comment || '').trim().slice(0, 500) || null;

  const id = uuidv4();
  run(`
    INSERT INTO reconciliation_marks
      (id, branch_id, counterparty_id, firm_id, contract_id, date, balance, comment, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    branchId,
    counterpartyId,
    normalizeScopeId(data?.firm_id),
    normalizeScopeId(data?.contract_id),
    date,
    Math.round(balance * 100) / 100,
    comment,
    userId || null,
  ]);
  return loadMark(id);
}

export function deleteReconciliationMark(branchId, id, user) {
  const mark = loadMark(id);
  if (!mark || mark.branch_id !== branchId) throw new Error('Отметка не найдена');
  if (user?.role !== 'admin' && mark.created_by !== user?.id) {
    const err = new Error('Удалить отметку может только тот, кто её поставил, или администратор');
    err.status = 403;
    throw err;
  }
  run('DELETE FROM reconciliation_marks WHERE id = ?', [id]);
  return mark;
}
