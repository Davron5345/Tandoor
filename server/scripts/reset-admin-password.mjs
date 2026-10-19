#!/usr/bin/env node
/**
 * One-shot: reset admin password in current DATABASE_URL.
 * Usage: node server/scripts/reset-admin-password.mjs [newPassword]
 * Prints nothing secret except confirming username; new password is echoed once if generated.
 */
import { scryptSync, randomBytes, randomUUID } from 'crypto';
import pg from 'pg';

const WEAK = new Set(['admin123', 'sklad123', 'kassir123', 'password', '12345678']);

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function genPassword() {
  // readable temp password, not in weak list
  const a = randomBytes(3).toString('hex');
  return `Tand${a}!2026`;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('NO_DATABASE_URL');
  process.exit(1);
}

const requested = String(process.argv[2] || '').trim();
const password = requested || genPassword();
if (password.length < 8) {
  console.error('PASSWORD_TOO_SHORT');
  process.exit(1);
}
if (WEAK.has(password.toLowerCase())) {
  console.error('PASSWORD_WEAK');
  process.exit(1);
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const hash = hashPassword(password);
const upd = await c.query(
  `UPDATE users
   SET password_hash = $1, must_change_password = 1, active = 1, role = 'admin', branch_id = NULL
   WHERE LOWER(username) = 'admin'
   RETURNING id, username`,
  [hash],
);

if (!upd.rowCount) {
  await c.query(
    `INSERT INTO users (id, username, password_hash, name, role, active, branch_id, must_change_password)
     VALUES ($1, 'admin', $2, 'Администратор', 'admin', 1, NULL, 1)`,
    [randomUUID(), hash],
  );
  console.log('ADMIN_CREATED');
} else {
  console.log('ADMIN_UPDATED', upd.rows[0].username);
}

// drop sessions so old cookies stop working
try {
  await c.query(
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE LOWER(username) = 'admin')`,
  );
  console.log('SESSIONS_CLEARED');
} catch (e) {
  console.log('SESSIONS_SKIP', e.message);
}

await c.end();
console.log('LOGIN', 'admin');
console.log('TEMP_PASSWORD', password);
console.log('MUST_CHANGE', '1');
