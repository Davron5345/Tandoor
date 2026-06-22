/**
 * Очистка операционных данных без удаления справочников.
 * npm run db:reset-operations
 */
import { initDb } from '../db.js';
import { resetOperationalData } from '../resetOperationalData.js';

async function main() {
  await initDb();
  const result = resetOperationalData();
  console.log('Операционные данные очищены.');
  console.log('До:', result.before);
  console.log('После:', result.after);
  console.log('Резервная копия:', result.backup);
  console.log('Сохранено товаров:', result.after.products);
  console.log('Сохранено контрагентов:', result.after.counterparties);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
