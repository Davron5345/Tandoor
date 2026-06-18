import { join } from 'path';
import { verifyDatabaseFile, listBackups, backupDir, dbPath } from '../dbBackup.js';
import { existsSync } from 'fs';

console.log('=== Проверка базы данных ===');
console.log('Файл:', dbPath);
console.log('Существует:', existsSync(dbPath));

const current = await verifyDatabaseFile();
if (current.ok) {
  console.log('✅ База читается, размер:', current.size);
  console.log('Записей:');
  for (const [table, count] of Object.entries(current.counts)) {
    console.log(`  ${table}: ${count ?? '—'}`);
  }
} else {
  console.error('❌ Ошибка:', current.error);
  process.exit(1);
}

const backups = listBackups();
console.log('\n=== Резервные копии ===');
console.log('Папка:', backupDir);
console.log('Количество:', backups.length);
for (const b of backups.slice(0, 5)) {
  const v = await verifyDatabaseFile(join(backupDir, b.filename));
  const status = v.ok ? 'OK' : 'BAD';
  console.log(`  [${status}] ${b.filename} (${b.size} байт)`);
}
if (backups.length > 5) console.log(`  ... и ещё ${backups.length - 5}`);
