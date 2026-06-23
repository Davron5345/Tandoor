import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

const { queryAll, queryOne, run, transaction } = db;

export const DEFAULT_UNITS = ['шт', 'кг', 'г', 'л', 'мл', 'м', 'м²', 'м³', 'уп', 'пач', 'кор'];

function normalizeUnitName(name) {
  return (name || '').trim();
}

function findUnitByName(name) {
  const normalized = normalizeUnitName(name);
  if (!normalized) return null;
  return queryOne('SELECT * FROM units WHERE name = ? COLLATE NOCASE', [normalized]);
}

export function getUnits() {
  return queryAll(`
    SELECT u.*,
      (SELECT COUNT(*) FROM products p WHERE p.unit = u.name) as usage_count
    FROM units u
    ORDER BY u.sort_order, u.name COLLATE NOCASE
  `).map((row) => ({
    ...row,
    usage_count: row.usage_count || 0,
  }));
}

export function assertValidUnitName(name) {
  const normalized = normalizeUnitName(name);
  if (!normalized) throw new Error('Укажите единицу измерения');
  let row = findUnitByName(normalized);
  if (!row) {
    createUnit({ name: normalized });
    row = findUnitByName(normalized);
  }
  return normalized;
}

export function createUnit(data) {
  const name = normalizeUnitName(data.name);
  if (!name) throw new Error('Укажите название единицы измерения');
  if (findUnitByName(name)) throw new Error('Такая единица уже есть');

  const id = uuidv4();
  const sortOrder = data.sort_order ?? queryOne('SELECT COALESCE(MAX(sort_order), 0) + 1 as n FROM units').n;
  run('INSERT INTO units (id, name, sort_order) VALUES (?, ?, ?)', [id, name, sortOrder]);
  return queryOne(`
    SELECT u.*,
      (SELECT COUNT(*) FROM products p WHERE p.unit = u.name) as usage_count
    FROM units u
    WHERE u.id = ?
  `, [id]);
}

export function updateUnit(id, data) {
  const unit = queryOne('SELECT * FROM units WHERE id = ?', [id]);
  if (!unit) throw new Error('Единица измерения не найдена');

  const name = normalizeUnitName(data.name ?? unit.name);
  if (!name) throw new Error('Укажите название единицы измерения');

  const duplicate = queryOne(
    'SELECT id FROM units WHERE name = ? COLLATE NOCASE AND id != ?',
    [name, id],
  );
  if (duplicate) throw new Error('Такая единица уже есть');

  const sortOrder = data.sort_order ?? unit.sort_order;

  transaction(() => {
    if (name !== unit.name) {
      run('UPDATE products SET unit = ? WHERE unit = ?', [name, unit.name]);
    }
    run('UPDATE units SET name = ?, sort_order = ? WHERE id = ?', [name, sortOrder, id]);
  });

  return queryOne(`
    SELECT u.*,
      (SELECT COUNT(*) FROM products p WHERE p.unit = u.name) as usage_count
    FROM units u
    WHERE u.id = ?
  `, [id]);
}

export function deleteUnit(id) {
  const unit = queryOne('SELECT * FROM units WHERE id = ?', [id]);
  if (!unit) throw new Error('Единица измерения не найдена');

  const usage = queryOne('SELECT COUNT(*) as c FROM products WHERE unit = ?', [unit.name]).c;
  if (usage > 0) {
    throw new Error(`Нельзя удалить: единица используется в ${usage} товарах`);
  }

  run('DELETE FROM units WHERE id = ?', [id]);
  return { ok: true };
}

export function seedUnitsIfNeeded() {
  DEFAULT_UNITS.forEach((name, index) => {
    if (!findUnitByName(name)) {
      run('INSERT INTO units (id, name, sort_order) VALUES (?, ?, ?)', [uuidv4(), name, index + 1]);
    }
  });

  const orphanUnits = queryAll(`
    SELECT DISTINCT unit as name
    FROM products
    WHERE unit IS NOT NULL AND TRIM(unit) != ''
      AND unit NOT IN (SELECT name FROM units)
  `);
  let nextSort = queryOne('SELECT COALESCE(MAX(sort_order), 0) as n FROM units').n;
  for (const row of orphanUnits) {
    const name = normalizeUnitName(row.name);
    if (!name || findUnitByName(name)) continue;
    nextSort += 1;
    run('INSERT INTO units (id, name, sort_order) VALUES (?, ?, ?)', [uuidv4(), name, nextSort]);
  }
}
