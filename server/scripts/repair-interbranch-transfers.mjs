/**
 * Досписание старых межфилиальных перемещений, которые не двигали остатки отделов.
 *
 *   node server/scripts/repair-interbranch-transfers.mjs          # только показать
 *   node server/scripts/repair-interbranch-transfers.mjs --apply  # перенести остатки
 *
 * Перед --apply проверьте список: если остаток уже поправили вручную, документ задвоится.
 */
import { initDb } from '../db.js';
import { repairLegacyInterBranchTransfers } from '../services/transferRepair.js';

async function main() {
  const apply = process.argv.includes('--apply');
  await initDb();
  const result = repairLegacyInterBranchTransfers({ apply });
  console.log(JSON.stringify(result, null, 2));
  console.log(apply
    ? `Исправлено: ${result.fixed.length}, пропущено: ${result.skipped.length}`
    : `Будет исправлено: ${result.fixed.length}, пропущено: ${result.skipped.length} (запустите с --apply)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
