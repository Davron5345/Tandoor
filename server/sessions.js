import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { getUserPayload } from './permissions.js';
import { parsePagination, buildPageResult } from './pagination.js';
import { extractRequestDevice } from './deviceInfo.js';
import { logVisit } from './visitLog.js';

const { queryAll, queryOne, run } = db;

const SESSION_DAYS = 7;
const SESSION_HOURS = 12;

export function cleanExpiredSessions() {
  run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
}

export function isDeviceBlocked(deviceId) {
  if (!deviceId) return null;
  return queryOne(`
    SELECT * FROM blocked_devices
    WHERE device_id = ?
      AND (expires_at IS NULL OR expires_at >= datetime('now'))
  `, [deviceId]);
}

function mapSessionRow(row, currentToken = null) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    username: row.username,
    user_name: row.user_name,
    role: row.role,
    ip: row.ip || null,
    user_agent: row.user_agent || null,
    device_label: row.device_label || 'Неизвестно',
    device_id: row.device_id || null,
    remember: !!row.remember,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at || row.created_at,
    expires_at: row.expires_at,
    is_current: currentToken ? row.token === currentToken : false,
  };
}

function activeSessionSql() {
  return `
    SELECT s.*, u.username, u.name as user_name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.expires_at >= datetime('now') AND u.active = 1
  `;
}

export function resolveAuthFromToken(token) {
  if (!token) return null;
  cleanExpiredSessions();

  const row = queryOne(`
    ${activeSessionSql()}
    AND s.token = ?
  `, [token]);

  if (!row) return null;

  if (row.device_id && isDeviceBlocked(row.device_id)) {
    run('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }

  return {
    user: getUserPayload(row),
    session: mapSessionRow(row, token),
    token,
  };
}

export function createSession(user, token, options = {}) {
  const { req, remember = false } = options;
  const device = req ? extractRequestDevice(req) : {};

  if (device.deviceId && isDeviceBlocked(device.deviceId)) {
    const err = new Error('Устройство заблокировано. Обратитесь к администратору.');
    err.code = 'DEVICE_BLOCKED';
    throw err;
  }

  const sessionId = uuidv4();
  const expires = new Date();
  if (remember) {
    expires.setDate(expires.getDate() + SESSION_DAYS);
  } else {
    expires.setHours(expires.getHours() + SESSION_HOURS);
  }

  const expiresAt = expires.toISOString().slice(0, 19).replace('T', ' ');

  run(`
    INSERT INTO sessions (
      id, user_id, token, expires_at, ip, user_agent, device_label, device_id,
      last_seen_at, remember
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `, [
    sessionId,
    user.id,
    token,
    expiresAt,
    device.ip || null,
    device.userAgent || null,
    device.deviceLabel || null,
    device.deviceId || null,
    remember ? 1 : 0,
  ]);

  return queryOne('SELECT * FROM sessions WHERE id = ?', [sessionId]);
}

export function touchSessionIfNeeded(token) {
  if (!token) return;
  run(`
    UPDATE sessions
    SET last_seen_at = datetime('now')
    WHERE token = ?
      AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-5 minutes'))
  `, [token]);
}

function buildSessionFilters(filters = {}) {
  let sql = '';
  const params = [];

  if (filters.user_id) {
    sql += ' AND s.user_id = ?';
    params.push(filters.user_id);
  }
  if (filters.username) {
    sql += ' AND u.username LIKE ?';
    params.push(`%${filters.username}%`);
  }
  if (filters.ip) {
    sql += ' AND s.ip LIKE ?';
    params.push(`%${filters.ip}%`);
  }
  if (filters.device_id) {
    sql += ' AND s.device_id = ?';
    params.push(filters.device_id);
  }

  return { sql, params };
}

export function listActiveSessions(filters = {}, currentToken = null) {
  const { sql: filterSql, params } = buildSessionFilters(filters);
  const baseSql = `${activeSessionSql()}${filterSql}`;
  const total = queryOne(`SELECT COUNT(*) as c FROM (${baseSql})`, params)?.c ?? 0;
  const pagination = parsePagination(filters) || { page: 1, limit: 50, offset: 0 };

  const rows = queryAll(
    `${baseSql} ORDER BY s.last_seen_at DESC, s.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pagination.limit, pagination.offset],
  );

  const recentThreshold = queryOne("SELECT datetime('now', '-15 minutes') as t")?.t;

  return buildPageResult(
    rows.map((row) => ({
      ...mapSessionRow(row, currentToken),
      is_active: (row.last_seen_at || row.created_at) >= recentThreshold,
    })),
    total,
    pagination,
  );
}

export function getSessionById(sessionId) {
  return queryOne(`
    ${activeSessionSql()}
    AND s.id = ?
  `, [sessionId]);
}

export function revokeSessionById(sessionId, req, { via = 'admin' } = {}) {
  const session = getSessionById(sessionId);
  if (!session) throw new Error('Сеанс не найден или уже завершён');

  run('DELETE FROM sessions WHERE id = ?', [sessionId]);

  logVisit(req, 'session.revoke', {
    user_id: session.user_id,
    username: session.username,
    ip: session.ip,
    user_agent: session.user_agent,
    device_id: session.device_id,
    device_label: session.device_label,
    meta: { via, session_id: sessionId },
  });

  return session;
}

export function revokeUserSessions(userId, exceptToken = null, req = null, via = 'admin') {
  const sessions = exceptToken
    ? queryAll('SELECT * FROM sessions WHERE user_id = ? AND token != ?', [userId, exceptToken])
    : queryAll('SELECT * FROM sessions WHERE user_id = ?', [userId]);

  if (exceptToken) {
    run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [userId, exceptToken]);
  } else {
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }

  if (req) {
    for (const session of sessions) {
      logVisit(req, 'session.revoke', {
        user_id: session.user_id,
        username: session.username,
        ip: session.ip,
        device_id: session.device_id,
        device_label: session.device_label,
        meta: { via, session_id: session.id },
      });
    }
  }

  return sessions.length;
}

export function listBlockedDevices(filters = {}) {
  let sql = `
    WHERE (bd.expires_at IS NULL OR bd.expires_at >= datetime('now'))
  `;
  const params = [];

  if (filters.device_id) {
    sql += ' AND bd.device_id = ?';
    params.push(filters.device_id);
  }
  if (filters.username) {
    sql += ' AND u.username LIKE ?';
    params.push(`%${filters.username}%`);
  }

  const total = queryOne(`
    SELECT COUNT(*) as c
    FROM blocked_devices bd
    LEFT JOIN users u ON u.id = bd.user_id
    ${sql}
  `, params)?.c ?? 0;

  const pagination = parsePagination(filters) || { page: 1, limit: 50, offset: 0 };

  const rows = queryAll(`
    SELECT bd.*, u.username as user_username, ub.username as blocked_by_username
    FROM blocked_devices bd
    LEFT JOIN users u ON u.id = bd.user_id
    LEFT JOIN users ub ON ub.id = bd.blocked_by
    ${sql}
    ORDER BY bd.blocked_at DESC
    LIMIT ? OFFSET ?
  `, [...params, pagination.limit, pagination.offset]);

  return buildPageResult(rows, total, pagination);
}

export function blockDevice(data, req) {
  const deviceId = (data.device_id || '').trim();
  if (!deviceId) throw new Error('Укажите device_id');

  const existing = isDeviceBlocked(deviceId);
  if (existing) throw new Error('Устройство уже заблокировано');

  const device = data.device_label || data.ip
    ? data
    : queryOne('SELECT device_label, ip, user_agent, user_id FROM sessions WHERE device_id = ? ORDER BY last_seen_at DESC LIMIT 1', [deviceId])
      || {};

  const id = uuidv4();
  const expiresAt = data.expires_at || null;

  run(`
    INSERT INTO blocked_devices (
      id, device_id, user_id, ip, device_label, user_agent, blocked_by, reason, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    deviceId,
    data.user_id || device.user_id || null,
    data.ip || device.ip || null,
    data.device_label || device.device_label || null,
    data.user_agent || device.user_agent || null,
    req?.user?.id || null,
    (data.reason || '').trim() || null,
    expiresAt,
  ]);

  run('DELETE FROM sessions WHERE device_id = ?', [deviceId]);

  logVisit(req, 'device.block', {
    device_id: deviceId,
    device_label: data.device_label || device.device_label,
    ip: data.ip || device.ip,
    meta: { reason: data.reason || null, blocked_id: id },
  });

  return queryOne('SELECT * FROM blocked_devices WHERE id = ?', [id]);
}

export function unblockDevice(blockedId, req) {
  const row = queryOne('SELECT * FROM blocked_devices WHERE id = ?', [blockedId]);
  if (!row) throw new Error('Запись блокировки не найдена');

  run('DELETE FROM blocked_devices WHERE id = ?', [blockedId]);

  logVisit(req, 'device.unblock', {
    device_id: row.device_id,
    device_label: row.device_label,
    ip: row.ip,
    meta: { blocked_id: blockedId },
  });

  return row;
}

export function blockDeviceFromSession(sessionId, reason, req) {
  const session = getSessionById(sessionId);
  if (!session) throw new Error('Сеанс не найден');

  if (!session.device_id) {
    throw new Error('У сеанса нет идентификатора устройства');
  }

  return blockDevice({
    device_id: session.device_id,
    user_id: session.user_id,
    ip: session.ip,
    device_label: session.device_label,
    user_agent: session.user_agent,
    reason,
  }, req);
}
