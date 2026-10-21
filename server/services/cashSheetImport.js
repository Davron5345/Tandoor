import { createHash } from 'crypto';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { ensureDefaultCashArticle } from '../cashArticles.js';
import { createPayment } from './payments.js';
import { recognizeCashSheetPhoto } from './openRouter.js';

const { queryOne } = db;

function normalizeLabelKey(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '')
    .slice(0, 80);
}

export function cashSheetExternalRef(date, kind, label, amount) {
  const key = `${kind}:${normalizeLabelKey(label)}:${Math.round(Number(amount) || 0)}`;
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `cash_sheet:${date}:${hash}`;
}

function formatDateRu(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Подбор статьи расхода по тексту строки.
 * «Закуп» в кассе требует поставщика + тип supplier_payment — для листа без контрагента
 * бозор/авансы/продукты пишем как хозрасход или прочий расход.
 */
export function resolveCashSheetArticleCode(kind, label) {
  if (kind === 'market') return 'exp_other';
  if (kind === 'payroll') return 'exp_salary';

  const t = String(label || '').toLowerCase();
  if (/инкасс|inkass/.test(t)) return 'exp_other';
  if (/аренд|ижара|ijara/.test(t)) return 'exp_rent';
  if (/бозор|bozor|аванс|abon|закуп|сырь|хом.?ашё|хамир|тухум|яйц|балиқ|балик|гўшт|гушт|помидор|напитк|комир|уголь/.test(t)) {
    return 'exp_household';
  }
  if (/мусор|мусур|такси|gazel|газел|бензин|хоз|налет|майда|чийд|кофе|coffee|чай|сантех|электрик|мебел|уста|охрана|фартук/.test(t)) {
    return 'exp_household';
  }
  return 'exp_household';
}

function buildRows(extraction, date) {
  const rows = [];
  for (const m of extraction.market || []) {
    rows.push({
      kind: 'market',
      label: m.label || 'Бозор',
      amount: m.amount,
      article_code: 'exp_other',
    });
  }
  for (const p of extraction.payroll || []) {
    rows.push({
      kind: 'payroll',
      label: p.label || 'ишчилар',
      amount: p.amount,
      article_code: 'exp_salary',
    });
  }
  for (const e of extraction.expenses || []) {
    rows.push({
      kind: 'expense',
      label: e.label,
      amount: e.amount,
      article_code: resolveCashSheetArticleCode('expense', e.label),
    });
  }

  return rows.map((row) => {
    const external_ref = cashSheetExternalRef(date, row.kind, row.label, row.amount);
    const comment = `${row.label} · ИИ · ${formatDateRu(date)}`;
    return { ...row, date, external_ref, comment, type: 'other_expense' };
  });
}

/**
 * Распознать фото и собрать план операций кассы (без записи).
 */
export async function previewCashSheetFromPhoto({
  imageBuffer,
  mimeType = 'image/jpeg',
  date: forceDate = null,
  branchId = DEFAULT_BRANCH_ID,
  model = null,
} = {}) {
  const extraction = await recognizeCashSheetPhoto(imageBuffer, mimeType, model ? { model } : {});
  const date = forceDate || extraction.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Не удалось определить дату листа — укажите --date=YYYY-MM-DD');
  }
  const planned = buildRows(extraction, date).map((row) => {
    const existing = queryOne(
      `SELECT id, number FROM payments
       WHERE external_ref = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))`,
      [row.external_ref, branchId, branchId, DEFAULT_BRANCH_ID],
    );
    return {
      ...row,
      already_imported: Boolean(existing),
      existing_payment_id: existing?.id || null,
      existing_number: existing?.number || null,
    };
  });
  const total = planned.reduce((s, r) => s + (r.already_imported ? 0 : r.amount), 0);
  return {
    date,
    branch_id: branchId,
    extraction: {
      date: extraction.date,
      expenses: extraction.expenses,
      market: extraction.market,
      payroll: extraction.payroll,
      skipped_notes: extraction.skipped_notes,
      model: extraction.model,
    },
    planned,
    summary: {
      count: planned.length,
      new_count: planned.filter((r) => !r.already_imported).length,
      skipped_dup: planned.filter((r) => r.already_imported).length,
      total_new: total,
    },
  };
}

/**
 * Создать кассовые расходы по плану (ai_recognized=1).
 */
export function applyCashSheetPlan(preview, { userId = null, branchId = DEFAULT_BRANCH_ID } = {}) {
  if (!preview?.planned?.length) {
    return { created: [], skipped: [], date: preview?.date || null };
  }
  const bid = branchId || preview.branch_id || DEFAULT_BRANCH_ID;
  const created = [];
  const skipped = [];

  for (const row of preview.planned) {
    if (row.already_imported) {
      skipped.push({ reason: 'duplicate', ...row });
      continue;
    }
    const articleId = ensureDefaultCashArticle(bid, row.article_code);
    try {
      const payment = createPayment({
        type: 'other_expense',
        amount: row.amount,
        date: row.date,
        comment: row.comment,
        article_id: articleId,
        external_ref: row.external_ref,
        import_batch_id: `cash_sheet:${row.date}`,
        ai_recognized: 1,
      }, userId, bid, null);
      created.push({
        id: payment.id,
        number: payment.number,
        amount: payment.amount,
        article_name: payment.article_name,
        comment: payment.comment,
        label: row.label,
        kind: row.kind,
      });
    } catch (e) {
      if (/уже загружен/i.test(e.message)) {
        skipped.push({ reason: 'duplicate', ...row });
        continue;
      }
      throw e;
    }
  }

  return {
    date: preview.date,
    created,
    skipped,
    summary: {
      created: created.length,
      skipped: skipped.length,
      total: created.reduce((s, r) => s + Number(r.amount || 0), 0),
    },
  };
}
