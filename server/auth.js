import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { getUserPayload, roleExists } from './permissions.js';
import { getBranch } from './branches.js';

const { queryAll, queryOne, run } = db;

const SESSION_DAYS = 7;
const MIN_PASSWORD_LENGTH = 8;
const WEAK_PASSWORDS = new Set(['admin123', 'sklad123', 'kassir123', 'password', '12345678']);

/** Главный администратор — роль и логин нельзя менять через интерфейс */
export const PROTECTED_ADMIN_USERNAME = 'admin';

export function isProtectedAdmin(userOrUsername) {
  const name = typeof userOrUsername === 'string'
    ? userOrUsername
    : userOrUsername?.username;
  return (name || '').trim().toLowerCase() === PROTECTED_ADMIN_USERNAME;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = scryptSync(password, salt, 64);
  if (hashBuf.length !== testBuf.length) return false;
  return timingSafeEqual(hashBuf, testBuf);
}

function cleanSessions() {
  run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
}

export function login(username, password) {
  cleanSessions();
  const loginName = (username || '').trim().toLowerCase();
  const pass = (password || '').trim();
  const user = queryOne('SELECT * FROM users WHERE LOWER(username) = ? AND active = 1', [loginName]);
  if (!user || !verifyPassword(pass, user.password_hash)) {
    throw new Error('Неверный логин или пароль');
  }

  const token = uuidv4();
  const sessionId = uuidv4();
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);

  run(`
    INSERT INTO sessions (id, user_id, token, expires_at)
    VALUES (?, ?, ?, ?)
  `, [sessionId, user.id, token, expires.toISOString().slice(0, 19).replace('T', ' ')]);

  return { token, user: getUserPayload(user) };
}

export function logout(token) {
  if (!token) return;
  run('DELETE FROM sessions WHERE token = ?', [token]);
}

export function getUserByToken(token) {
  if (!token) return null;
  cleanSessions();
  const row = queryOne(`
    SELECT u.* FROM users u
    JOIN sessions s ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at >= datetime('now') AND u.active = 1
  `, [token]);
  return row ? getUserPayload(row) : null;
}

export function changePassword(userId, currentPassword, newPassword, keepToken = null) {
  const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('Пользователь не найден');
  if (!verifyPassword((currentPassword || '').trim(), user.password_hash)) {
    throw new Error('Неверный текущий пароль');
  }

  const nextPassword = (newPassword || '').trim();
  if (nextPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов`);
  }
  if (WEAK_PASSWORDS.has(nextPassword.toLowerCase())) {
    throw new Error('Слишком простой пароль. Выберите другой');
  }

  run(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    [hashPassword(nextPassword), userId],
  );

  if (keepToken) {
    run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [userId, keepToken]);
  } else {
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }

  const updated = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  return getUserPayload(updated);
}

export function getUsers(requester, branchId = null) {
  let sql = `
    SELECT u.id, u.username, u.name, u.role, u.active, u.created_at, u.branch_id,
           b.name as branch_name
    FROM users u
    LEFT JOIN branches b ON b.id = u.branch_id
  `;
  const params = [];
  if (requester?.role === 'admin') {
    if (branchId) {
      sql += ' WHERE u.branch_id = ? OR u.role = ?';
      params.push(branchId, 'admin');
    }
  } else if (requester?.branch_id) {
    sql += ' WHERE u.branch_id = ?';
    params.push(requester.branch_id);
  }
  sql += ' ORDER BY u.name';

  return queryAll(sql, params).map((u) => ({
    ...u,
    roleLabel: getUserPayload(u).roleLabel,
    active: !!u.active,
    protected: isProtectedAdmin(u.username),
  }));
}

export function createUser(data) {
  const username = (data.username || '').trim();
  if (isProtectedAdmin(username)) {
    throw new Error('Логин «admin» зарезервирован для главного администратора');
  }
  const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) throw new Error('Логин уже занят');
  if (!roleExists(data.role)) throw new Error('Роль не найдена');

  let branchId = data.branch_id || null;
  if (data.role !== 'admin') {
    if (!branchId) throw new Error('Укажите филиал для сотрудника');
    if (!getBranch(branchId)) throw new Error('Филиал не найден');
  } else {
    branchId = null;
  }

  const id = uuidv4();
  run(`
    INSERT INTO users (id, username, password_hash, name, role, active, branch_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    username,
    hashPassword(data.password),
    data.name.trim(),
    data.role,
    data.active !== false ? 1 : 0,
    branchId,
  ]);

  return queryOne(`
    SELECT u.id, u.username, u.name, u.role, u.active, u.created_at, u.branch_id,
           b.name as branch_name
    FROM users u
    LEFT JOIN branches b ON b.id = u.branch_id
    WHERE u.id = ?
  `, [id]);
}

export function updateUser(id, data) {
  const user = queryOne('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) throw new Error('Сотрудник не найден');

  if (isProtectedAdmin(user)) {
    if (data.role && data.role !== 'admin') {
      throw new Error('Нельзя изменить роль главного администратора');
    }
    if (data.username && data.username.trim().toLowerCase() !== PROTECTED_ADMIN_USERNAME) {
      throw new Error('Нельзя изменить логин главного администратора');
    }
    if (data.active === false) {
      throw new Error('Нельзя отключить главного администратора');
    }
    if (data.branch_id !== undefined && data.branch_id !== null) {
      throw new Error('Нельзя привязать главного администратора к филиалу');
    }

    const nextName = (data.name || user.name).trim();
    if (data.password) {
      run('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', [
        nextName, hashPassword(data.password), id,
      ]);
    } else {
      run('UPDATE users SET name = ? WHERE id = ?', [nextName, id]);
    }

    return queryOne(`
      SELECT u.id, u.username, u.name, u.role, u.active, u.created_at, u.branch_id,
             b.name as branch_name
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.id = ?
    `, [id]);
  }

  if (data.username && data.username.trim() !== user.username) {
    const existing = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [data.username.trim(), id]);
    if (existing) throw new Error('Логин уже занят');
  }

  if (data.role && !roleExists(data.role)) throw new Error('Роль не найдена');

  const nextRole = data.role || user.role;
  let branchId = data.branch_id !== undefined ? (data.branch_id || null) : user.branch_id;
  if (nextRole === 'admin') {
    branchId = null;
  } else if (data.branch_id !== undefined || data.role) {
    if (!branchId) throw new Error('Укажите филиал для сотрудника');
    if (!getBranch(branchId)) throw new Error('Филиал не найден');
  }

  run(`
    UPDATE users
    SET username = ?, name = ?, role = ?, active = ?, branch_id = ?
    WHERE id = ?
  `, [
    (data.username || user.username).trim(),
    (data.name || user.name).trim(),
    nextRole,
    data.active !== undefined ? (data.active ? 1 : 0) : user.active,
    branchId,
    id,
  ]);

  if (data.password) {
    run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(data.password), id]);
  }

  if (data.active === false) {
    run('DELETE FROM sessions WHERE user_id = ?', [id]);
  }

  return queryOne('SELECT id, username, name, role, active, created_at FROM users WHERE id = ?', [id]);
}

export function deleteUser(id) {
  const user = queryOne('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) throw new Error('Сотрудник не найден');
  if (isProtectedAdmin(user)) throw new Error('Нельзя удалить главного администратора');
  run('DELETE FROM sessions WHERE user_id = ?', [id]);
  run('DELETE FROM users WHERE id = ?', [id]);
}

function getSettingLocal(key) {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value || null;
}

function setSettingLocal(key, value) {
  const existing = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) {
    run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
  } else {
    run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
}

export function seedDefaultUsers() {
  const defaults = [
    [PROTECTED_ADMIN_USERNAME, 'admin123', 'Администратор', 'admin'],
    ['sklad', 'sklad123', 'Завсклад', 'warehouse'],
    ['kassir', 'kassir123', 'Кассир', 'cashier'],
  ];

  for (const [username, password, name, role] of defaults) {
    const existing = queryOne('SELECT id FROM users WHERE LOWER(username) = ?', [username]);
    if (!existing) {
      run(`
        INSERT INTO users (id, username, password_hash, name, role, active)
        VALUES (?, ?, ?, ?, ?, 1)
      `, [uuidv4(), username, hashPassword(password), name, role]);
    }
  }

  ensureProtectedAdmin();

  if (!getSettingLocal('default_users_v2')) {
    if (process.env.NODE_ENV !== 'production') {
      for (const [username, password, name, role] of defaults) {
        run(`
          UPDATE users SET password_hash = ?, name = ?, role = ?, active = 1
          WHERE LOWER(username) = ?
        `, [hashPassword(password), name, role, username]);
      }
    }
    setSettingLocal('default_users_v2', '1');
  }

  run("UPDATE users SET branch_id = 'main' WHERE role != 'admin' AND (branch_id IS NULL OR branch_id = '')");
}

/** Главный admin всегда существует, активен и с ролью admin */
function ensureProtectedAdmin() {
  const mustChange = process.env.NODE_ENV === 'production' ? 1 : 0;
  const admin = queryOne('SELECT * FROM users WHERE LOWER(username) = ?', [PROTECTED_ADMIN_USERNAME]);
  if (!admin) {
    run(`
      INSERT INTO users (id, username, password_hash, name, role, active, branch_id, must_change_password)
      VALUES (?, ?, ?, ?, 'admin', 1, NULL, ?)
    `, [uuidv4(), PROTECTED_ADMIN_USERNAME, hashPassword('admin123'), 'Администратор', mustChange]);
    return;
  }

  if (admin.role !== 'admin' || !admin.active || admin.branch_id) {
    run(`
      UPDATE users SET role = 'admin', active = 1, branch_id = NULL
      WHERE id = ?
    `, [admin.id]);
  }
}
