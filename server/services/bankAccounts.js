import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';

const { queryAll, queryOne, run } = db;

export function normalizeBankAccountNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

export function getBankAccounts(branchId = DEFAULT_BRANCH_ID, { activeOnly = false } = {}) {
  let sql = `
    SELECT * FROM bank_accounts
    WHERE branch_id = ?
  `;
  const params = [branchId];
  if (activeOnly) sql += ' AND active = 1';
  sql += ' ORDER BY is_default DESC, name ASC';
  return queryAll(sql, params);
}

export function getBankAccount(id, branchId = DEFAULT_BRANCH_ID) {
  return queryOne(
    'SELECT * FROM bank_accounts WHERE id = ? AND branch_id = ?',
    [id, branchId],
  );
}

export function findBankAccountByNumber(accountNumber, branchId = DEFAULT_BRANCH_ID) {
  const num = normalizeBankAccountNumber(accountNumber);
  if (!num) return null;
  return queryOne(
    `SELECT * FROM bank_accounts
     WHERE branch_id = ? AND account_number = ? AND active = 1`,
    [branchId, num],
  );
}

export function getDefaultBankAccount(branchId = DEFAULT_BRANCH_ID) {
  return queryOne(
    `SELECT * FROM bank_accounts
     WHERE branch_id = ? AND active = 1
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`,
    [branchId],
  );
}

function clearDefault(branchId) {
  run('UPDATE bank_accounts SET is_default = 0 WHERE branch_id = ?', [branchId]);
}

export function createBankAccount(data, branchId = DEFAULT_BRANCH_ID) {
  const name = String(data.name || '').trim();
  const accountNumber = normalizeBankAccountNumber(data.account_number);
  if (!name) throw new Error('Укажите название счёта');
  if (!accountNumber) throw new Error('Укажите номер расчётного счёта');
  if (accountNumber.length < 16) throw new Error('Номер р/с слишком короткий');

  const dup = findBankAccountByNumber(accountNumber, branchId);
  if (dup) throw new Error(`Счёт с р/с ${accountNumber} уже есть: «${dup.name}»`);

  const existing = getBankAccounts(branchId);
  const makeDefault = data.is_default === true || data.is_default === 1 || existing.length === 0;
  if (makeDefault) clearDefault(branchId);

  const id = uuidv4();
  const currency = String(data.currency || 'UZS').trim().toUpperCase() || 'UZS';
  run(
    `INSERT INTO bank_accounts
      (id, branch_id, name, account_number, currency, is_default, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, branchId, name, accountNumber, currency, makeDefault ? 1 : 0],
  );
  return getBankAccount(id, branchId);
}

export function updateBankAccount(id, data, branchId = DEFAULT_BRANCH_ID) {
  const row = getBankAccount(id, branchId);
  if (!row) throw new Error('Счёт не найден');

  const name = data.name !== undefined ? String(data.name || '').trim() : row.name;
  const accountNumber = data.account_number !== undefined
    ? normalizeBankAccountNumber(data.account_number)
    : row.account_number;
  const currency = data.currency !== undefined
    ? (String(data.currency || '').trim().toUpperCase() || row.currency)
    : row.currency;
  const active = data.active !== undefined ? (data.active ? 1 : 0) : row.active;

  if (!name) throw new Error('Укажите название счёта');
  if (!accountNumber) throw new Error('Укажите номер расчётного счёта');

  if (accountNumber !== row.account_number) {
    const dup = findBankAccountByNumber(accountNumber, branchId);
    if (dup && dup.id !== id) {
      throw new Error(`Счёт с р/с ${accountNumber} уже есть: «${dup.name}»`);
    }
  }

  if (data.is_default === true || data.is_default === 1) {
    clearDefault(branchId);
  }

  const isDefault = (data.is_default === true || data.is_default === 1)
    ? 1
    : ((data.is_default === false || data.is_default === 0) ? 0 : row.is_default);

  run(
    `UPDATE bank_accounts
     SET name = ?, account_number = ?, currency = ?, is_default = ?, active = ?
     WHERE id = ? AND branch_id = ?`,
    [name, accountNumber, currency, isDefault, active, id, branchId],
  );
  return getBankAccount(id, branchId);
}

export function deleteBankAccount(id, branchId = DEFAULT_BRANCH_ID) {
  const row = getBankAccount(id, branchId);
  if (!row) throw new Error('Счёт не найден');

  const usedPay = queryOne(
    'SELECT id FROM payments WHERE bank_account_id = ? LIMIT 1',
    [id],
  );
  if (usedPay) throw new Error('Счёт используется в операциях — нельзя удалить');

  const usedOb = queryOne(
    'SELECT id FROM opening_balance_lines WHERE bank_account_id = ? LIMIT 1',
    [id],
  );
  if (usedOb) throw new Error('Счёт указан в начальном сальдо — нельзя удалить');

  run('DELETE FROM bank_accounts WHERE id = ? AND branch_id = ?', [id, branchId]);
  return { ok: true };
}

export function assertBankAccountInBranch(accountId, branchId = DEFAULT_BRANCH_ID) {
  if (!accountId) return null;
  const row = getBankAccount(accountId, branchId);
  if (!row) throw new Error('Банковский счёт не найден');
  if (!row.active) throw new Error('Банковский счёт неактивен');
  return row;
}
