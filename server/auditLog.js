import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { parsePagination, buildPageResult } from './pagination.js';

const { queryAll, queryOne, run } = db;

export const AUDIT_ACTION_LABELS = {
  'auth.login': 'Вход',
  'auth.logout': 'Выход',
  'auth.change_password': 'Смена пароля',
  'document.confirm': 'Проведение документа',
  'document.cancel': 'Отмена документа',
  'opening_balance.settings': 'Начальное сальдо: настройки',
  'opening_balance.stock': 'Начальное сальдо: остатки',
  'opening_balance.counterparties': 'Начальное сальдо: контрагенты',
};

export function formatAuditAction(action) {
  return AUDIT_ACTION_LABELS[action] || action;
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

export function logAudit(req, action, details = {}) {
  const user = req?.user || null;
  const payload = {
    entity_type: details.entity_type || null,
    entity_id: details.entity_id || null,
    meta: details.meta || null,
  };

  run(`
    INSERT INTO audit_log (id, user_id, username, action, entity_type, entity_id, details, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    uuidv4(),
    user?.id || null,
    user?.username || user?.name || null,
    action,
    payload.entity_type,
    payload.entity_id,
    payload.meta ? JSON.stringify(payload.meta) : null,
    req ? getClientIp(req) : null,
  ]);
}

function buildAuditWhere(filters = {}) {
  let sql = ' WHERE 1=1';
  const params = [];

  if (filters.action) {
    sql += ' AND action = ?';
    params.push(filters.action);
  }
  if (filters.username) {
    sql += ' AND username LIKE ?';
    params.push(`%${filters.username}%`);
  }
  if (filters.date_from) {
    sql += ' AND created_at >= ?';
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    sql += ' AND created_at <= ?';
    params.push(`${filters.date_to} 23:59:59`);
  }

  return { sql, params };
}

export function getAuditLog(filters = {}) {
  const { sql: whereSql, params } = buildAuditWhere(filters);
  const total = queryOne(`SELECT COUNT(*) as c FROM audit_log${whereSql}`, params)?.c ?? 0;

  const pagination = parsePagination(filters) || { page: 1, limit: 50, offset: 0 };
  const rows = queryAll(
    `SELECT * FROM audit_log${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pagination.limit, pagination.offset],
  );

  return buildPageResult(
    rows.map((row) => ({
      ...row,
      action_label: formatAuditAction(row.action),
      meta: row.details ? safeParseJson(row.details) : null,
    })),
    total,
    pagination,
  );
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
