import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

const { queryAll, queryOne, run } = db;

export const DEFAULT_BRANCH_ID = 'main';

export function getBranches(activeOnly = false) {
  let sql = 'SELECT * FROM branches';
  if (activeOnly) sql += ' WHERE active = 1';
  sql += ' ORDER BY name';
  return queryAll(sql);
}

export function getBranch(id) {
  return queryOne('SELECT * FROM branches WHERE id = ?', [id]);
}

export function createBranch(data) {
  const id = (data.id || uuidv4()).trim();
  const name = (data.name || '').trim();
  if (!name) throw new Error('Укажите название филиала');

  const existing = queryOne('SELECT id FROM branches WHERE id = ?', [id]);
  if (existing) throw new Error('Филиал с таким кодом уже существует');

  run(
    'INSERT INTO branches (id, name, address, phone, active) VALUES (?, ?, ?, ?, ?)',
    [id, name, (data.address || '').trim(), (data.phone || '').trim(), data.active !== false ? 1 : 0],
  );
  return getBranch(id);
}

export function updateBranch(id, data) {
  const branch = getBranch(id);
  if (!branch) throw new Error('Филиал не найден');
  if (id === DEFAULT_BRANCH_ID && data.active === false) {
    throw new Error('Нельзя отключить главный филиал');
  }

  const name = (data.name || branch.name).trim();
  if (!name) throw new Error('Укажите название филиала');

  run(
    'UPDATE branches SET name = ?, address = ?, phone = ?, active = ? WHERE id = ?',
    [
      name,
      data.address !== undefined ? (data.address || '').trim() : branch.address,
      data.phone !== undefined ? (data.phone || '').trim() : branch.phone,
      data.active !== undefined ? (data.active ? 1 : 0) : branch.active,
      id,
    ],
  );
  return getBranch(id);
}

export function deleteBranch(id) {
  if (id === DEFAULT_BRANCH_ID) throw new Error('Нельзя удалить главный филиал');

  const branch = getBranch(id);
  if (!branch) throw new Error('Филиал не найден');

  const usersCount = queryOne('SELECT COUNT(*) as c FROM users WHERE branch_id = ?', [id]).c;
  if (usersCount > 0) throw new Error('В филиале есть сотрудники — сначала переназначьте их');

  const docsCount = queryOne(
    'SELECT COUNT(*) as c FROM documents WHERE branch_id = ? OR from_branch_id = ? OR to_branch_id = ?',
    [id, id, id],
  ).c;
  if (docsCount > 0) throw new Error('В филиале есть документы — удаление невозможно');

  const cpCount = queryOne('SELECT COUNT(*) as c FROM counterparties WHERE branch_id = ?', [id]).c;
  if (cpCount > 0) throw new Error('В филиале есть контрагенты — удаление невозможно');

  run('DELETE FROM product_branch_stock WHERE branch_id = ?', [id]);
  run('DELETE FROM branches WHERE id = ?', [id]);
}

export function resolveBranchId(user, requestedBranchId) {
  if (user.role === 'admin') {
    if (requestedBranchId) {
      const branch = getBranch(requestedBranchId);
      if (!branch || !branch.active) throw new Error('Филиал не найден');
      return requestedBranchId;
    }
    return DEFAULT_BRANCH_ID;
  }

  if (!user.branch_id) throw new Error('Сотрудник не привязан к филиалу');
  if (requestedBranchId && requestedBranchId !== user.branch_id) {
    throw new Error('Нет доступа к этому филиалу');
  }
  return user.branch_id;
}

export function assertBranchAccess(user, branchId) {
  if (user.role === 'admin') return;
  if (user.branch_id !== branchId) throw new Error('Нет доступа к этому филиалу');
}

export function getBranchStock(productId, branchId) {
  const row = queryOne(
    'SELECT stock FROM product_branch_stock WHERE branch_id = ? AND product_id = ?',
    [branchId, productId],
  );
  return row?.stock || 0;
}

export function adjustBranchStock(branchId, productId, delta) {
  const row = queryOne(
    'SELECT id, stock FROM product_branch_stock WHERE branch_id = ? AND product_id = ?',
    [branchId, productId],
  );
  if (row) {
    run(
      'UPDATE product_branch_stock SET stock = stock + ?, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?',
      [delta, branchId, productId],
    );
  } else {
    run(
      'INSERT INTO product_branch_stock (id, branch_id, product_id, stock) VALUES (?, ?, ?, ?)',
      [uuidv4(), branchId, productId, delta],
    );
  }
}

export function enrichBranch(branch) {
  if (!branch) return null;
  return { ...branch, active: !!branch.active };
}

export function getBranchesEnriched(activeOnly = false) {
  return getBranches(activeOnly).map(enrichBranch);
}
