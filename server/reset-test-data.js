/**
 * Очистка операционных данных для повторного тестирования.
 * Важно: остановите dev-сервер или используйте POST /api/admin/reset-test-data.
 */
import db, { initDb } from './db.js';
import { resetTestData } from './resetTestData.js';

async function main() {
  await initDb();
  const result = resetTestData();
  console.log('Очистка завершена.');
  console.log('До:', result.before);
  console.log('После:', result.after);
  console.log(`Удалено товаров (с медиа): ${result.deletedProducts}`);
  console.log('Контрагенты сохранены:', result.after.counterparties);

  const left = result.after.documents + result.after.products + result.after.calculations;
  if (left > 0) {
    console.error('Внимание: данные остались. Остановите npm run dev и запустите скрипт снова.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
