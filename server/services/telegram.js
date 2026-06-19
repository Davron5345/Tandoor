import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const { queryAll, queryOne, run } = db;

export function logTelegramMessage(data) {
  const id = uuidv4();
  run(`
    INSERT INTO telegram_messages (id, counterparty_id, document_id, chat_id, message, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    id, data.counterparty_id || null, data.document_id || null,
    data.chat_id, data.message, data.status, data.error || null
  ]);
  return id;
}

export function getTelegramMessages(limit = 50, branchId = null) {
  if (!branchId) {
    return queryAll(`
      SELECT tm.*, c.name as counterparty_name, d.number as document_number
      FROM telegram_messages tm
      LEFT JOIN counterparties c ON c.id = tm.counterparty_id
      LEFT JOIN documents d ON d.id = tm.document_id
      ORDER BY tm.created_at DESC
      LIMIT ?
    `, [limit]);
  }

  return queryAll(`
    SELECT tm.*, c.name as counterparty_name, d.number as document_number
    FROM telegram_messages tm
    LEFT JOIN counterparties c ON c.id = tm.counterparty_id
    LEFT JOIN documents d ON d.id = tm.document_id
    WHERE (
      (d.id IS NOT NULL AND (d.branch_id = ? OR d.from_branch_id = ? OR d.to_branch_id = ?))
      OR (d.id IS NULL AND (c.branch_id = ? OR c.branch_id IS NULL))
    )
    ORDER BY tm.created_at DESC
    LIMIT ?
  `, [branchId, branchId, branchId, branchId, limit]);
}

export function getSetting(key) {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value || null;
}

export function setSetting(key, value) {
  const existing = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) {
    run('UPDATE settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [value, key]);
  } else {
    run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  return value;
}

export function deleteSetting(key) {
  run('DELETE FROM settings WHERE key = ?', [key]);
}

export function maskToken(token) {
  if (!token || token.length < 12) return token ? '••••••••' : '';
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

export function getTelegramSettings() {
  const token = getSetting('telegram_bot_token');
  return {
    hasToken: !!token,
    tokenMasked: maskToken(token),
    updatedAt: queryOne('SELECT updated_at FROM settings WHERE key = ?', ['telegram_bot_token'])?.updated_at || null,
  };
}

export function saveTelegramToken(token) {
  const trimmed = (token || '').trim();
  if (!trimmed) throw new Error('Токен не может быть пустым');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error('Неверный формат токена. Пример: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
  }
  setSetting('telegram_bot_token', trimmed);
  return getTelegramSettings();
}

export function removeTelegramToken() {
  deleteSetting('telegram_bot_token');
  return getTelegramSettings();
}