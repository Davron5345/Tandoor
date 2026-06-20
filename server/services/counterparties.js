import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';

const { queryAll, queryOne, run } = db;

export const DEFAULT_CONTRACT_ID = '__default__';

export function isSupplierCounterpartyDoc(type) {
  return type === 'prihod' || type === 'return_supplier';
}

export function getCounterparties(type, branchId = DEFAULT_BRANCH_ID) {
  let sql = 'SELECT * FROM counterparties WHERE branch_id = ?';
  const params = [branchId];
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  sql += ' ORDER BY type, name';
  return queryAll(sql, params);
}

export function getCounterparty(id, branchId = null) {
  if (branchId) {
    return queryOne('SELECT * FROM counterparties WHERE id = ? AND branch_id = ?', [id, branchId]);
  }
  return queryOne('SELECT * FROM counterparties WHERE id = ?', [id]);
}

export function assertCounterpartyBranch(counterpartyId, branchId, docType = null) {
  if (!counterpartyId) return;
  const cp = queryOne('SELECT id, type, branch_id FROM counterparties WHERE id = ?', [counterpartyId]);
  if (!cp) throw new Error('Контрагент не найден');
  if (cp.branch_id !== branchId) throw new Error('Контрагент принадлежит другому филиалу');
  if (isSupplierCounterpartyDoc(docType) && cp.type !== 'supplier') {
    throw new Error('Для прихода/возврата нужен поставщик');
  }
  if (docType === 'rashod' && cp.type !== 'client') throw new Error('Для расхода нужен клиент');
  if (docType === 'return_customer' && cp.type !== 'client') throw new Error('Для возврата нужен клиент');
}

export function createCounterparty(data, branchId = DEFAULT_BRANCH_ID) {
  const id = uuidv4();
  const openingBalance = Number(data.opening_balance);
  const safeOpening = Number.isFinite(openingBalance) ? openingBalance : 0;
  run(`
    INSERT INTO counterparties (id, name, type, phone, email, telegram_chat_id, address, notes, branch_id, opening_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, data.name, data.type, data.phone || '', data.email || '',
    data.telegram_chat_id || '', data.address || '', data.notes || '', branchId, safeOpening,
  ]);
  return queryOne('SELECT * FROM counterparties WHERE id = ?', [id]);
}

export function updateCounterparty(id, data, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCounterparty(id, branchId);
  if (!existing) throw new Error('Контрагент не найден');
  const openingBalance = data.opening_balance !== undefined
    ? Number(data.opening_balance)
    : (existing.opening_balance || 0);
  if (!Number.isFinite(openingBalance)) throw new Error('Некорректное начальное сальдо');
  run(`
    UPDATE counterparties
    SET name=?, type=?, phone=?, email=?, telegram_chat_id=?, address=?, notes=?,
        opening_balance=?, updated_at=datetime('now')
    WHERE id=? AND branch_id=?
  `, [
    data.name, data.type, data.phone || '', data.email || '',
    data.telegram_chat_id || '', data.address || '', data.notes || '',
    openingBalance, id, branchId,
  ]);
  return queryOne('SELECT * FROM counterparties WHERE id = ?', [id]);
}

export function deleteCounterparty(id, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCounterparty(id, branchId);
  if (!existing) throw new Error('Контрагент не найден');
  run('DELETE FROM counterparty_contracts WHERE counterparty_id = ? AND branch_id = ?', [id, branchId]);
  run('DELETE FROM product_suppliers WHERE supplier_id = ? AND branch_id = ?', [id, branchId]);
  run('DELETE FROM counterparties WHERE id = ? AND branch_id = ?', [id, branchId]);
}

export function getCounterpartyContracts(counterpartyId, branchId = DEFAULT_BRANCH_ID) {
  const cp = getCounterparty(counterpartyId, branchId);
  if (!cp) throw new Error('Контрагент не найден');

  const contracts = queryAll(`
    SELECT id, counterparty_id, branch_id, number, date, is_default, created_at
    FROM counterparty_contracts
    WHERE counterparty_id = ? AND branch_id = ?
    ORDER BY is_default DESC, date DESC, number
  `, [counterpartyId, branchId]);

  if (contracts.length === 0) {
    return [{
      id: DEFAULT_CONTRACT_ID,
      counterparty_id: counterpartyId,
      branch_id: branchId,
      number: 'Основной договор',
      date: null,
      is_default: 1,
      virtual: true,
    }];
  }

  return contracts;
}

export function createCounterpartyContract(counterpartyId, data, branchId = DEFAULT_BRANCH_ID) {
  const cp = getCounterparty(counterpartyId, branchId);
  if (!cp) throw new Error('Контрагент не найден');
  const number = (data.number || '').trim();
  if (!number) throw new Error('Укажите номер договора');

  const id = uuidv4();
  run(`
    INSERT INTO counterparty_contracts (id, counterparty_id, branch_id, number, date, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, counterpartyId, branchId, number, data.date || null, data.is_default ? 1 : 0]);

  return queryOne('SELECT * FROM counterparty_contracts WHERE id = ?', [id]);
}

export function deleteCounterpartyContract(counterpartyId, contractId, branchId = DEFAULT_BRANCH_ID) {
  if (contractId === DEFAULT_CONTRACT_ID) throw new Error('Нельзя удалить основной договор');
  const row = queryOne(
    'SELECT id FROM counterparty_contracts WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [contractId, counterpartyId, branchId],
  );
  if (!row) throw new Error('Договор не найден');
  run('UPDATE documents SET contract_id = NULL WHERE contract_id = ?', [contractId]);
  run('DELETE FROM counterparty_contracts WHERE id = ?', [contractId]);
}
