/**
 * Список резервных копий БД с количеством записей.
 * npm run db:list-backups
 */
import initSqlJs from 'sql.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { listBackups, dbPath, backupDir } from '../dbBackup.js';

const SQL = await initSqlJs();
const tables = ['products', 'documents', 'payments', 'counterparties', 'branches', 'users'];

function inspect(path) {
  const db = new SQL.Database(readFileSync(path));
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
  return counts;
}

console.log('Текущая БД:', dbPath);
if (existsSync(dbPath)) {
  console.log('  ', JSON.stringify(inspect(dbPath)));
} else {
  console.log('   (файл не найден)');
}

console.log('\nРезервные копии (data/backups/):');
for (const backup of listBackups()) {
  const path = join(backupDir, backup.filename);
  const counts = inspect(path);
  console.log(`- ${backup.filename} (${backup.size} байт)`);
  console.log(`    ${JSON.stringify(counts)}`);
}
