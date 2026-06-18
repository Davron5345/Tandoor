/**
 * Восстановление БД из резервной копии.
 * npm run db:restore -- warehouse_2026-06-18-07-07-45_pre-migration.db
 * npm run db:restore -- best   — самая полная копия
 */
import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import db, { initDb, reloadDb } from '../db.js';
import { restoreDatabaseFromBackup, listBackups, backupDir } from '../dbBackup.js';
import { initPermissions } from '../permissions.js';
import { seedDefaultUsers } from '../auth.js';
import { migrateDepartmentStockSync } from '../departments.js';

const arg = process.argv[2];

let filename = arg;
if (!filename || filename === 'best') {
  const backups = listBackups();
  const SQL = await initSqlJs();
  let best = null;
  let bestScore = -1;

  for (const backup of backups) {
    const path = join(backupDir, backup.filename);
    const handle = new SQL.Database(readFileSync(path));
    const score = (table) => {
      try {
        const stmt = handle.prepare(`SELECT COUNT(*) as c FROM ${table}`);
        stmt.step();
        const c = stmt.getAsObject().c;
        stmt.free();
        return c;
      } catch {
        return 0;
      }
    };
    const s = score('documents') * 100
      + score('payments') * 50
      + score('products') * 10
      + score('branches') * 20
      + score('counterparties') * 5;
    handle.close();
    if (s > bestScore) {
      bestScore = s;
      best = backup.filename;
    }
  }

  if (!best) {
    console.error('Резервные копии не найдены в data/backups/');
    process.exit(1);
  }
  filename = best;
  console.log('Выбрана самая полная копия:', filename);
}

await initDb();
const result = await restoreDatabaseFromBackup(filename);
await reloadDb();
initPermissions(db);
migrateDepartmentStockSync();
seedDefaultUsers();

console.log('Восстановлено из:', result.restored);
console.log('Записей:', result.counts);
console.log('Перезапустите сервер: npm run dev');
