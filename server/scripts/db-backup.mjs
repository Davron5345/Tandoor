import { backupDatabaseFile, listBackups, verifyDatabaseFile, dbPath } from '../dbBackup.js';

const backup = backupDatabaseFile('manual');
if (!backup) {
  console.error('База не найдена:', dbPath);
  process.exit(1);
}

console.log('✅ Бэкап создан:', backup.filename);
console.log('   Размер:', backup.size, 'байт');
console.log('   Всего бэкапов:', listBackups().length);

const check = await verifyDatabaseFile();
console.log('   Проверка текущей БД:', check.ok ? 'OK' : check.error);
if (check.ok) console.log('   Записей:', check.counts);
