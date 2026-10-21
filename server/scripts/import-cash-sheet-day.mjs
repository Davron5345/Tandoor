#!/usr/bin/env node
/**
 * Распознать дневной лист кассы с фото и (опционально) записать в кассу.
 *
 *   node server/scripts/import-cash-sheet-day.mjs "/path/to.jpg" --date=2026-10-20
 *   node server/scripts/import-cash-sheet-day.mjs "/path/to.jpg" --date=2026-10-20 --apply
 *
 * Без --apply только превью JSON. Нужен OpenRouter в settings (openrouter_config).
 */
import fs from 'fs';
import path from 'path';
import { initDb } from '../db.js';
import { isOpenRouterReady } from '../services/openRouter.js';
import { applyCashSheetPlan, previewCashSheetFromPhoto } from '../services/cashSheetImport.js';

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const date = argValue('--date=');
  const branchId = argValue('--branch=') || 'main';
  const model = argValue('--model=');
  // Не брать process.execPath / node — только явный путь к картинке среди аргументов
  const filePath = process.argv.slice(2).find((a) => {
    if (a.startsWith('-')) return false;
    return /\.(jpe?g|png|webp|gif)$/i.test(a);
  });

  if (!filePath) {
    console.error('Укажите путь к jpg/png (например: …/лист.jpg --date=2026-10-20)');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error('Файл не найден:', filePath);
    process.exit(1);
  }

  await initDb();
  if (!isOpenRouterReady()) {
    console.error('OpenRouter не настроен (settings.openrouter_config: api_key + model)');
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(filePath);
  const preview = await previewCashSheetFromPhoto({
    imageBuffer,
    mimeType: guessMime(filePath),
    date: date || null,
    branchId,
    model: model || null,
  });

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'preview',
    file: path.basename(filePath),
    ...preview,
    extraction: {
      ...preview.extraction,
      raw: undefined,
    },
  }, null, 2));

  if (!apply) {
    console.error(`\nПревью: ${preview.summary.new_count} новых, ${preview.summary.skipped_dup} уже есть, сумма новых ${preview.summary.total_new}. Для записи добавьте --apply`);
    return;
  }

  const result = applyCashSheetPlan(preview, { branchId });
  console.log(JSON.stringify({ applied: result }, null, 2));
  console.error(`\nЗаписано: ${result.summary.created}, пропущено: ${result.summary.skipped}, сумма ${result.summary.total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
