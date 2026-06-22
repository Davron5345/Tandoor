import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { parsePagination, buildPageResult } from './pagination.js';
import { extractRequestDevice } from './deviceInfo.js';

const { queryAll, queryOne, run } = db;

export const VISIT_ACTION_LABELS = {
  'auth.login': 'Успешный вход',
  'auth.login_failed': 'Неудачный вход',
  'auth.login_blocked': 'Вход заблокирован',
  'auth.logout': 'Выход',
  'session.revoke': 'Сеанс завершён',
  'device.block': 'Устройство заблокировано',
  'device.unblock': 'Устройство разблокировано',
};

export function formatVisitAction(action) {
  return VISIT_ACTION_LABELS[action] || action;
}

export function logVisit(req, action, details = {}) {
  const user = req?.user || null;
  const device = req ? extractRequestDevice(req) : {};
  const username = details.username || user?.username || user?.name || null;
  const success = details.success !== false ? 1 : 0;

  run(`
    INSERT INTO visit_log (
      id, user_id, username, action, success, ip, user_agent, device_id, device_label, details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    uuidv4(),
    user?.id || details.user_id || null,
    username,
    action,
    success,
    device.ip || details.ip || null,
    device.userAgent || details.user_agent || null,
    device.deviceId || details.device_id || null,
    device.deviceLabel || details.device_label || null,
    details.meta ? JSON.stringify(details.meta) : null,
  ]);
}

function buildVisitWhere(filters = {}) {
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
  if (filters.ip) {
    sql += ' AND ip LIKE ?';
    params.push(`%${filters.ip}%`);
  }
  if (filters.device_id) {
    sql += ' AND device_id = ?';
    params.push(filters.device_id);
  }
  if (filters.success === '1' || filters.success === '0') {
    sql += ' AND success = ?';
    params.push(Number(filters.success));
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

export function getVisitLog(filters = {}) {
  const { sql: whereSql, params } = buildVisitWhere(filters);
  const total = queryOne(`SELECT COUNT(*) as c FROM visit_log${whereSql}`, params)?.c ?? 0;
  const pagination = parsePagination(filters) || { page: 1, limit: 50, offset: 0 };

  const rows = queryAll(
    `SELECT * FROM visit_log${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pagination.limit, pagination.offset],
  );

  return buildPageResult(
    rows.map((row) => ({
      ...row,
      action_label: formatVisitAction(row.action),
      success: !!row.success,
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

export function purgeOldVisitLog(days = 90) {
  run(`DELETE FROM visit_log WHERE created_at < datetime('now', '-' || ? || ' days')`, [days]);
}
