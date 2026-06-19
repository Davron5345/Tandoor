import initSqlJs from 'sql.js';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync,
  readdirSync, statSync, unlinkSync, renameSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDataDir() {
  const fromEnv = process.env.DATA_DIR || process.env.WAREHOUSE_DATA_DIR;
  if (fromEnv) {
    return fromEnv.startsWith('/') || /^[A-Za-z]:[\\/]/.test(fromEnv)
      ? fromEnv
      : join(process.cwd(), fromEnv);
  }
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return process.env.RAILWAY_VOLUME_MOUNT_PATH;
  }
  return join(__dirname, '..', 'data');
}

export const dataDir = resolveDataDir();
export const dbPath = join(dataDir, 'warehouse.db');
export const backupDir = join(dataDir, 'backups');
export const uploadsDir = join(dataDir, 'uploads');

export const MAX_BACKUPS = 30;

function pad(n) {
  return String(n).padStart(2, '0');
}

export function timestampLabel(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('-');
}

function ensureDirs() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
}

export function pruneOldBackups() {
  if (!existsSync(backupDir)) return;
  const files = readdirSync(backupDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({ name: f, path: join(backupDir, f), mtime: statSync(join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files.slice(MAX_BACKUPS)) {
    try {
      unlinkSync(file.path);
    } catch {
      // ignore
    }
  }
}

/**
 * Копирует текущий warehouse.db в data/backups/
 * @param {string} reason — метка: startup, migration, reset, manual
 */
export function backupDatabaseFile(reason = 'manual') {
  ensureDirs();
  if (!existsSync(dbPath)) return null;

  const stat = statSync(dbPath);
  if (stat.size < 1) return null;

  const safeReason = (reason || 'manual').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
  const filename = `warehouse_${timestampLabel()}_${safeReason}.db`;
  const dest = join(backupDir, filename);

  copyFileSync(dbPath, dest);
  pruneOldBackups();

  return { filename, path: dest, size: stat.size, reason: safeReason };
}

/**
 * Атомарная запись буфера БД на диск (сначала .tmp, затем rename).
 */
export function writeDatabaseAtomic(buffer) {
  ensureDirs();
  const tmpPath = `${dbPath}.tmp`;
  writeFileSync(tmpPath, buffer);
  try {
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch {
        // ignore — replace via copy below
      }
    }
    renameSync(tmpPath, dbPath);
  } catch {
    copyFileSync(tmpPath, dbPath);
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
}

export function listBackups() {
  ensureDirs();
  if (!existsSync(backupDir)) return [];

  return readdirSync(backupDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const path = join(backupDir, f);
      const stat = statSync(path);
      return {
        filename: f,
        size: stat.size,
        created_at: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function verifyDatabaseFile(path = dbPath) {
  if (!existsSync(path)) {
    return { ok: false, error: 'Файл не найден' };
  }

  try {
    const SQL = await initSqlJs();
    const buffer = readFileSync(path);
    const db = new SQL.Database(buffer);

    const tables = ['products', 'documents', 'document_items', 'payments', 'users', 'counterparties'];
    const counts = {};
    for (const table of tables) {
      try {
        const stmt = db.prepare(`SELECT COUNT(*) as c FROM ${table}`);
        stmt.step();
        counts[table] = stmt.getAsObject().c;
        stmt.free();
      } catch {
        counts[table] = null;
      }
    }

    db.close();
    return { ok: true, size: buffer.length, counts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Восстановление из бэкапа (текущая БД предварительно сохраняется).
 */
export async function restoreDatabaseFromBackup(filename) {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Некорректное имя файла');
  }

  const src = join(backupDir, filename);
  if (!existsSync(src)) throw new Error('Бэкап не найден');

  const check = await verifyDatabaseFile(src);
  if (!check.ok) throw new Error(`Бэкап повреждён: ${check.error}`);

  if (existsSync(dbPath)) {
    backupDatabaseFile('before-restore');
  }

  copyFileSync(src, dbPath);
  return { ok: true, restored: filename, counts: check.counts };
}
