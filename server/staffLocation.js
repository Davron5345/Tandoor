import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

const { queryAll, queryOne, run } = db;

const MAX_AGE_MINUTES = 24 * 60;

function validateCoords(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Некорректные координаты');
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Координаты вне допустимого диапазона');
  }
  return { lat, lng };
}

export function saveStaffLocation(userId, branchId, payload = {}) {
  const { lat, lng } = validateCoords(payload.latitude, payload.longitude);
  const accuracy = payload.accuracy != null ? Number(payload.accuracy) : null;
  const source = (payload.source || 'pwa').slice(0, 20);

  run('DELETE FROM staff_locations WHERE user_id = ?', [userId]);
  run(`
    INSERT INTO staff_locations (user_id, branch_id, latitude, longitude, accuracy, recorded_at, source)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
  `, [userId, branchId || null, lat, lng, accuracy, source]);

  run(`
    INSERT INTO staff_location_history (id, user_id, branch_id, latitude, longitude, accuracy, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), userId, branchId || null, lat, lng, accuracy, source]);

  return getStaffLocation(userId);
}

export function getStaffLocation(userId) {
  const row = queryOne('SELECT * FROM staff_locations WHERE user_id = ?', [userId]);
  if (!row) return null;
  const user = queryOne('SELECT username, name, role, active FROM users WHERE id = ?', [userId]);
  const branch = row.branch_id
    ? queryOne('SELECT name FROM branches WHERE id = ?', [row.branch_id])
    : null;
  return {
    ...row,
    username: user?.username || null,
    user_name: user?.name || null,
    role: user?.role || null,
    branch_name: branch?.name || null,
    maps_url: `https://www.openstreetmap.org/?mlat=${row.latitude}&mlon=${row.longitude}#map=17/${row.latitude}/${row.longitude}`,
  };
}

export function listStaffLocations(filters = {}) {
  let sql = `
    SELECT sl.*
    FROM staff_locations sl
    WHERE sl.recorded_at >= datetime('now', '-${MAX_AGE_MINUTES} minutes')
  `;
  const params = [];

  if (filters.branch_id) {
    sql += ' AND sl.branch_id = ?';
    params.push(filters.branch_id);
  }

  sql += ' ORDER BY sl.recorded_at DESC';

  const rows = queryAll(sql, params);

  return rows.map((row) => {
    const user = queryOne(
      'SELECT username, name, role, active FROM users WHERE id = ?',
      [row.user_id],
    );
    if (!user?.active) return null;
    if (filters.username && !user.username?.toLowerCase().includes(String(filters.username).toLowerCase())) {
      return null;
    }
    const branch = row.branch_id
      ? queryOne('SELECT name FROM branches WHERE id = ?', [row.branch_id])
      : null;
    return {
      ...row,
      username: user.username,
      user_name: user.name,
      role: user.role,
      branch_name: branch?.name || null,
      maps_url: `https://www.openstreetmap.org/?mlat=${row.latitude}&mlon=${row.longitude}#map=17/${row.latitude}/${row.longitude}`,
    };
  }).filter(Boolean);
}
