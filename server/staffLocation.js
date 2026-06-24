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

function normalizeIsoDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function normalizeTime(value, fallback) {
  const time = String(value || fallback).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : fallback;
}

export function listStaffLocationHistory(filters = {}) {
  const userId = filters.user_id;
  if (!userId) throw new Error('Укажите сотрудника');

  const date = normalizeIsoDate(filters.date) || new Date().toISOString().slice(0, 10);
  const timeFrom = normalizeTime(filters.time_from, '08:00');
  const timeTo = normalizeTime(filters.time_to, '22:00');
  const from = `${date} ${timeFrom}:00`;
  const to = `${date} ${timeTo}:59`;

  let sql = `
    SELECT *
    FROM staff_location_history
    WHERE user_id = ?
      AND recorded_at >= ?
      AND recorded_at <= ?
  `;
  const params = [userId, from, to];

  if (filters.branch_id) {
    sql += ' AND branch_id = ?';
    params.push(filters.branch_id);
  }

  sql += ' ORDER BY recorded_at ASC';

  const rows = queryAll(sql, params);
  const user = queryOne('SELECT username, name, role, active FROM users WHERE id = ?', [userId]);

  return {
    user_id: userId,
    username: user?.username || null,
    user_name: user?.name || null,
    date,
    time_from: timeFrom,
    time_to: timeTo,
    points: rows.map((row) => ({
      id: row.id,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      recorded_at: row.recorded_at,
      source: row.source,
      branch_id: row.branch_id,
    })),
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
