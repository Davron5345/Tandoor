import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import {
  matchKey,
  matchTokens,
  parsePrihodMessage,
  scoreTokens,
  splitPastedTelegramText,
} from '../telegramPrihodParser.js';
import { confirmDocument, createDocument, getDocument, updateDocument } from './documents.js';
import { isOpenRouterReady, recognizePrihodPhoto } from './openRouter.js';
import {
  saveDocumentAttachmentBuffer,
  saveInboxMediaBuffer,
  readInboxMediaBuffer,
} from '../documentAttachments.js';
import { telegramUrlFromInboxRow } from '../telegramLinks.js';
import { addProductVariant, getPrihodPrefillPriceMap, lastPriceForItem } from './products.js';

const { queryAll, queryOne, run } = db;

const TIME_ZONE = 'Asia/Tashkent';
const AUTO_MATCH_MIN_SCORE = 70;
const AUTO_MATCH_MIN_GAP = 5;
const SUPPLIER_LINK_BONUS = 6;
const SUGGEST_MIN_SCORE = 25;
const GRAM_UNITS = new Set(['г', 'гр', 'грамм']);
const PIECE_UNITS = new Set(['шт', 'та', 'дона', 'штук']);

function localDateTime(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    at: `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`,
  };
}

function formatQty(n) {
  return String(Math.round(Number(n) * 1000) / 1000).replace('.', ',');
}

function formatMessageAt(at) {
  if (!at) return '';
  const [d, t] = String(at).split('T');
  const [, m, day] = d.split('-');
  return t ? `${day}.${m} ${t}` : `${day}.${m}`;
}

// ── Темы (группы с темами) ────────────────────────────────────────────

export function recordTopic({ chatId, threadId, chatTitle = null, topicTitle = null }) {
  const chat = String(chatId);
  const thread = threadId ? String(threadId) : '';
  const existing = queryOne('SELECT * FROM telegram_topics WHERE chat_id = ? AND thread_id = ?', [chat, thread]);
  if (!existing) {
    const id = uuidv4();
    run(`
      INSERT INTO telegram_topics (id, chat_id, thread_id, chat_title, title, last_message_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `, [id, chat, thread, chatTitle, topicTitle]);
    return queryOne('SELECT * FROM telegram_topics WHERE id = ?', [id]);
  }
  run(`
    UPDATE telegram_topics
    SET chat_title = COALESCE(?, chat_title), title = COALESCE(?, title), last_message_at = datetime('now')
    WHERE id = ?
  `, [chatTitle, topicTitle, existing.id]);
  return queryOne('SELECT * FROM telegram_topics WHERE id = ?', [existing.id]);
}

export function listTopics(branchId) {
  return queryAll(`
    SELECT t.*, dep.name as department_name
    FROM telegram_topics t
    LEFT JOIN departments dep ON dep.id = t.department_id
    WHERE t.branch_id = ? OR t.branch_id IS NULL
    ORDER BY t.last_message_at DESC, t.created_at DESC
  `, [branchId]).map((t) => ({
    ...t,
    auto_create: !!t.auto_create,
    auto_confirm: !!t.auto_confirm,
    notify: !!t.notify,
  }));
}

function assertDepartmentInBranch(departmentId, branchId) {
  const dep = departmentId
    ? queryOne('SELECT id FROM departments WHERE id = ? AND branch_id = ?', [departmentId, branchId])
    : null;
  if (!dep) throw new Error('Выберите отдел (склад) этого филиала');
}

export function updateTopic(id, data, branchId) {
  const topic = queryOne('SELECT * FROM telegram_topics WHERE id = ?', [id]);
  if (!topic) throw new Error('Тема не найдена');
  if (topic.branch_id && topic.branch_id !== branchId) {
    throw new Error('Тема привязана к другому филиалу');
  }
  const mode = data.mode === 'prihod' ? 'prihod' : 'off';
  if (mode === 'prihod') assertDepartmentInBranch(data.department_id, branchId);
  run(`
    UPDATE telegram_topics
    SET mode = ?, branch_id = ?, department_id = ?, auto_create = ?, auto_confirm = ?, notify = ?
    WHERE id = ?
  `, [
    mode,
    mode === 'prihod' ? branchId : null,
    mode === 'prihod' ? data.department_id : null,
    data.auto_create === false ? 0 : 1,
    data.auto_confirm ? 1 : 0,
    data.notify === false ? 0 : 1,
    id,
  ]);
  return listTopics(branchId).find((t) => t.id === id);
}

// ── Сопоставление названий ────────────────────────────────────────────

function loadAliases(branchId, kind) {
  const map = new Map();
  for (const row of queryAll('SELECT * FROM telegram_aliases WHERE branch_id = ? AND kind = ?', [branchId, kind])) {
    map.set(row.alias_key, row);
  }
  return map;
}

function saveAlias(branchId, kind, aliasKey, targetId, variantId = null, userId = null) {
  if (!aliasKey || !targetId) return;
  run('DELETE FROM telegram_aliases WHERE branch_id = ? AND kind = ? AND alias_key = ?', [branchId, kind, aliasKey]);
  run(`
    INSERT INTO telegram_aliases (id, branch_id, kind, alias_key, target_id, variant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), branchId, kind, aliasKey, targetId, variantId || null, userId]);
}

function splitKeywords(raw) {
  return String(raw || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}

function buildMatchContext(branchId) {
  const products = queryAll(`
    SELECT id, name, unit, has_variants, keywords FROM products WHERE COALESCE(archived, 0) = 0
  `);
  const variants = queryAll(`
    SELECT v.id, v.product_id, v.name
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE COALESCE(v.archived, 0) = 0 AND COALESCE(p.archived, 0) = 0
    ORDER BY v.sort_order, v.name
  `);
  const variantsByProduct = new Map();
  for (const v of variants) {
    if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
    variantsByProduct.get(v.product_id).push(v);
  }

  const candidates = [];
  for (const p of products) {
    const names = [p.name, ...splitKeywords(p.keywords)];
    const pv = p.has_variants ? (variantsByProduct.get(p.id) || []) : [];
    if (!pv.length) {
      candidates.push({
        product_id: p.id, variant_id: null, label: p.name, unit: p.unit || 'шт', tokenSets: names.map(matchTokens),
      });
      continue;
    }
    for (const v of pv) {
      candidates.push({
        product_id: p.id,
        variant_id: v.id,
        label: `${p.name} — ${v.name}`,
        unit: p.unit || 'шт',
        tokenSets: [...names.map((n) => matchTokens(`${n} ${v.name}`)), matchTokens(v.name)],
      });
    }
  }
  const candidateIndex = new Map(candidates.map((c) => [`${c.product_id}:${c.variant_id || ''}`, c]));

  const suppliers = queryAll(`
    SELECT id, name FROM counterparties
    WHERE type = 'supplier' AND COALESCE(branch_id, 'main') = ?
    ORDER BY name
  `, [branchId]).map((s) => ({ ...s, tokens: matchTokens(s.name) }));

  const priceMaps = new Map();
  const supplierProducts = new Map();
  return {
    branchId,
    candidates,
    candidateIndex,
    suppliers,
    /** Товары, которые у поставщика есть: привязка в карточке, его приходы и прайсы. */
    supplierProductIds(supplierId) {
      if (!supplierId) return null;
      if (!supplierProducts.has(supplierId)) {
        const ids = new Set(
          queryAll('SELECT product_id FROM product_suppliers WHERE supplier_id = ? AND branch_id = ?', [supplierId, branchId])
            .map((r) => r.product_id),
        );
        for (const r of queryAll(`
          SELECT DISTINCT di.product_id
          FROM document_items di
          JOIN documents d ON d.id = di.document_id
          WHERE d.counterparty_id = ? AND d.type IN ('prihod', 'supplier_price') AND d.status <> 'cancelled'
            AND COALESCE(d.branch_id, 'main') = ?
        `, [supplierId, branchId])) {
          ids.add(r.product_id);
        }
        supplierProducts.set(supplierId, ids);
      }
      return supplierProducts.get(supplierId);
    },
    productAliases: loadAliases(branchId, 'product'),
    supplierAliases: loadAliases(branchId, 'supplier'),
    priceFor(supplierId, date, productId, variantId) {
      const cacheKey = `${supplierId || ''}|${date || ''}`;
      if (!priceMaps.has(cacheKey)) {
        priceMaps.set(cacheKey, getPrihodPrefillPriceMap(branchId, supplierId || null, date || null) || {});
      }
      return Number(lastPriceForItem(priceMaps.get(cacheKey), productId, variantId)) || 0;
    },
  };
}

function pickBest(scored) {
  scored.sort((a, b) => b.score - a.score);
  const [top, second] = scored;
  const auto = !!top && top.score >= AUTO_MATCH_MIN_SCORE
    && (!second || top.score - second.score >= AUTO_MATCH_MIN_GAP);
  return { top: auto ? top : null, scored };
}

function publicCandidate(c) {
  return { product_id: c.product_id, variant_id: c.variant_id, label: c.label, unit: c.unit };
}

function matchProduct(ctx, name, supplierId) {
  const alias = ctx.productAliases.get(matchKey(name));
  if (alias) {
    const cand = ctx.candidateIndex.get(`${alias.target_id}:${alias.variant_id || ''}`);
    if (cand) return { match: cand, via: 'alias', suggestions: [] };
  }
  const query = matchTokens(name);
  const own = ctx.supplierProductIds(supplierId);
  const scored = [];
  for (const c of ctx.candidates) {
    const score = Math.max(...c.tokenSets.map((tokens) => scoreTokens(query, tokens)));
    if (score < SUGGEST_MIN_SCORE) continue;
    scored.push({ c, score, own: !!own?.has(c.product_id) });
  }

  // Сначала то, что у этого поставщика есть; не нашли — весь справочник
  const ownScored = scored.filter((s) => s.own);
  const ownPick = ownScored.length ? pickBest(ownScored).top : null;
  const { top } = ownPick ? { top: ownPick } : pickBest(scored.slice());
  scored.sort((a, b) => (b.score + (b.own ? SUPPLIER_LINK_BONUS : 0)) - (a.score + (a.own ? SUPPLIER_LINK_BONUS : 0)));
  return {
    match: top?.c || null,
    via: top ? (top.own ? 'supplier' : 'name') : null,
    suggestions: scored.slice(0, 6).map((s) => ({ ...publicCandidate(s.c), own: s.own })),
  };
}

function matchSupplier(ctx, supplier) {
  if (!supplier) return { match: null, suggestions: [] };
  const names = [...new Set([supplier.name, supplier.raw].filter(Boolean))];
  for (const name of names) {
    const alias = ctx.supplierAliases.get(matchKey(name));
    const cp = alias && ctx.suppliers.find((s) => s.id === alias.target_id);
    if (cp) return { match: cp, via: 'alias', suggestions: [] };
  }
  const queries = names.map(matchTokens).filter((t) => t.length);
  const scored = [];
  for (const s of ctx.suppliers) {
    const score = Math.max(0, ...queries.map((q) => scoreTokens(q, s.tokens)));
    if (score >= SUGGEST_MIN_SCORE) scored.push({ s, score });
  }
  const { top } = pickBest(scored);
  return {
    match: top?.s || null,
    via: top ? 'name' : null,
    suggestions: scored.slice(0, 6).map((x) => ({ id: x.s.id, name: x.s.name })),
  };
}

function convertQuantity(line, productUnit) {
  const unit = String(productUnit || '').trim().toLowerCase();
  if (line.unit === 'кг' && GRAM_UNITS.has(unit)) return Math.round(line.quantity * 1000 * 1000) / 1000;
  if (line.unit === 'кг' && PIECE_UNITS.has(unit) && line.pieces) return line.pieces;
  return line.quantity;
}

function groupJson(group, notes) {
  return JSON.stringify({ supplier: group.supplier, lines: group.lines, notes });
}

function readParsed(entry) {
  try {
    const parsed = JSON.parse(entry.parsed_json || '{}');
    return { supplier: parsed.supplier || null, lines: parsed.lines || [], notes: parsed.notes || [] };
  } catch {
    return { supplier: null, lines: [], notes: [] };
  }
}

function analyzeEntry(entry, ctx) {
  const parsed = readParsed(entry);
  const supplierMatch = matchSupplier(ctx, parsed.supplier);
  const supplierId = supplierMatch.match?.id || null;
  const lines = parsed.lines.map((line, index) => {
    const m = matchProduct(ctx, line.name, supplierId);
    const cand = m.match;
    const qty = cand ? convertQuantity(line, cand.unit) : line.quantity;
    const rawPrice = line.price != null && Number(line.price) > 0 ? Number(line.price) : null;
    const rawAmount = line.amount != null && Number(line.amount) > 0 ? Number(line.amount) : null;
    let price = rawPrice;
    if (!(price > 0) && rawAmount > 0 && qty > 0) price = rawAmount / qty;
    if (!(price > 0) && cand) {
      price = ctx.priceFor(supplierId, entry.doc_date, cand.product_id, cand.variant_id) || 0;
    }
    return {
      index,
      raw: line.raw,
      name: line.name,
      parsed_quantity: line.quantity,
      parsed_unit: line.unit,
      pieces: line.pieces,
      amount: rawAmount,
      product_id: cand?.product_id || null,
      variant_id: cand?.variant_id || null,
      product_label: cand?.label || null,
      product_unit: cand?.unit || null,
      quantity: qty,
      price: price || 0,
      matched_via: m.via,
      suggestions: m.suggestions,
    };
  });
  return {
    date: entry.doc_date,
    supplier: parsed.supplier
      ? {
        raw: parsed.supplier.raw,
        name: parsed.supplier.name,
        counterparty_id: supplierId,
        counterparty_name: supplierMatch.match?.name || null,
        matched_via: supplierMatch.via,
        suggestions: supplierMatch.suggestions,
      }
      : null,
    lines,
    notes: parsed.notes,
    extra_costs: Array.isArray(parsed.extra_costs) ? parsed.extra_costs : [],
    total: parsed.total ?? null,
    ready: !!supplierId && lines.length > 0 && lines.every((l) => l.product_id),
  };
}

// ── Создание прихода ──────────────────────────────────────────────────

function ensureSupplierLinks(branchId, supplierId, items) {
  for (const productId of new Set(items.map((i) => i.product_id).filter(Boolean))) {
    run(
      'INSERT OR IGNORE INTO product_suppliers (id, product_id, supplier_id, branch_id) VALUES (?, ?, ?, ?)',
      [uuidv4(), productId, supplierId, branchId],
    );
  }
}

function entryComment(entry) {
  const parts = [entry.source === 'ai_photo' ? '🟡 Из Telegram · ИИ' : 'Из Telegram'];
  if (entry.from_name) parts.push(entry.from_name);
  if (entry.message_at) parts.push(formatMessageAt(entry.message_at));
  return parts.join(' · ');
}

function attachInboxMediaToDocument(entry, documentId) {
  if (!entry?.media_file_name || !documentId) return;
  try {
    const buf = readInboxMediaBuffer(entry.id, entry.media_file_name);
    if (!buf?.length) return;
    saveDocumentAttachmentBuffer(documentId, buf, {
      mimeType: entry.media_mime || 'image/jpeg',
      originalName: entry.media_file_name,
      source: 'telegram',
    });
  } catch (e) {
    console.error('Telegram приход: не удалось перенести фото во вложение:', e.message);
  }
}

function enrichInboxRow(row) {
  const rest = { ...row };
  delete rest.parsed_json;
  const isPhoto = row.source === 'ai_photo' || !!row.media_file_name;
  const mediaUrl = row.media_file_name
    ? `/uploads/telegram-inbox/${row.id}/${row.media_file_name}`
    : null;
  return {
    ...rest,
    edited: !!row.edited,
    source_kind: row.source === 'paste' ? 'paste' : isPhoto ? 'photo' : 'text',
    source_label: row.source === 'paste' ? 'Вставка' : isPhoto ? 'Фото' : 'Текст',
    media_url: mediaUrl,
    /** Фото-источник без сохранённого файла (старые записи до фикса) — нужна ручная привязка */
    media_missing: isPhoto && !mediaUrl,
    /** Ссылка на исходное сообщение в группе/теме Telegram */
    telegram_url: telegramUrlFromInboxRow(row),
  };
}

/** Прикрепить исходное фото/скрин к входящему (для сообщений без сохранённого файла). */
export function attachInboxMedia(id, buffer, mimeType, branchId) {
  const entry = getEntry(id, branchId);
  if (!buffer?.length) throw new Error('Пустой файл');
  const mediaMeta = saveInboxMediaBuffer(id, buffer, mimeType || 'image/jpeg');
  if (!mediaMeta) throw new Error('Не удалось сохранить файл');
  run(`
    UPDATE telegram_inbox
    SET media_file_name = ?, media_mime = ?,
        source = CASE WHEN source IN ('paste', 'telegram') THEN 'ai_photo' ELSE source END,
        updated_at = datetime('now')
    WHERE id = ?
  `, [mediaMeta.file_name, mediaMeta.mime_type, id]);

  const updated = { ...entry, media_file_name: mediaMeta.file_name, media_mime: mediaMeta.mime_type };
  if (entry.document_id && liveDocument(entry)) {
    attachInboxMediaToDocument(updated, entry.document_id);
  }
  return enrichInboxRow(queryOne('SELECT * FROM telegram_inbox WHERE id = ?', [id]));
}

/** Реакция 👍 на сообщение в группе, когда из него создан приход (в т.ч. вручную из входящих). */
function markTelegramSourceTaken(entry) {
  if (!entry?.chat_id || entry.chat_id === 'paste' || !entry.message_id) return;
  import('../telegram.js')
    .then((mod) => mod.reactToSourceMessage(entry.chat_id, entry.message_id))
    .catch((err) => console.error('Telegram реакция:', err.message));
}

function liveDocument(entry) {
  if (!entry.document_id) return null;
  return queryOne('SELECT id, number, status FROM documents WHERE id = ?', [entry.document_id]);
}

function createPrihodFromEntry(entry, payload, userId) {
  if (entry.status === 'created' && liveDocument(entry)) {
    throw new Error('По этому сообщению приход уже создан');
  }
  if (!payload.counterparty_id) throw new Error('Выберите поставщика');
  const departmentId = payload.department_id || entry.department_id;
  assertDepartmentInBranch(departmentId, entry.branch_id);
  const items = (payload.items || [])
    .filter((i) => i.product_id)
    .map((i) => {
      const row = {
        product_id: i.product_id,
        variant_id: i.variant_id || null,
        quantity: Number(i.quantity),
        price: Number(i.price) || 0,
      };
      if (i.amount != null && Number(i.amount) > 0) row.amount = Number(i.amount);
      return row;
    });
  if (!items.length) throw new Error('Сопоставьте хотя бы один товар');

  ensureSupplierLinks(entry.branch_id, payload.counterparty_id, items);
  const fromPhoto = entry.source === 'ai_photo' || !!entry.media_file_name;
  const parsed = readParsed(entry);
  const extraCosts = Array.isArray(payload.extra_costs)
    ? payload.extra_costs
    : (Array.isArray(parsed.extra_costs) ? parsed.extra_costs : undefined);
  const doc = createDocument({
    type: 'prihod',
    date: payload.date || entry.doc_date,
    counterparty_id: payload.counterparty_id,
    to_department_id: departmentId,
    comment: entryComment(entry),
    items: fromPhoto
      ? items.map((i) => ({ ...i, ai_confirmed: 0, ai_raw_name: i.ai_raw_name || null }))
      : items,
    extra_costs: extraCosts?.length ? extraCosts : undefined,
    ai_recognized: fromPhoto,
    ai_pending_items: fromPhoto ? (payload.ai_pending_items || []) : undefined,
  }, userId, entry.branch_id);

  attachInboxMediaToDocument(entry, doc.id);

  run(`
    UPDATE telegram_inbox
    SET status = 'created', document_id = ?, department_id = ?, error = NULL, updated_at = datetime('now')
    WHERE id = ?
  `, [doc.id, departmentId, entry.id]);
  markTelegramSourceTaken(entry);

  let confirmed = false;
  let confirmError = null;
  if (payload.confirm) {
    try {
      confirmDocument(doc.id, userId);
      confirmed = true;
    } catch (e) {
      confirmError = e.message;
      run('UPDATE telegram_inbox SET error = ? WHERE id = ?', [`Не проведён: ${e.message}`, entry.id]);
    }
  }
  return { document: getDocument(doc.id, entry.branch_id), confirmed, confirm_error: confirmError };
}

function itemsFromAnalysis(analysis) {
  return analysis.lines
    .filter((l) => l.product_id)
    .map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity, price: l.price }));
}

function linesSummary(analysis) {
  return analysis.lines
    .map((l) => `• ${l.product_label || l.name} — ${formatQty(l.quantity)} ${l.product_unit || l.parsed_unit || ''}`.trim())
    .join('\n');
}

function autoProcessEntry(entry, topic, ctx) {
  const analysis = analyzeEntry(entry, ctx);
  if (!topic.auto_create || !analysis.ready) {
    const missing = [];
    if (!analysis.supplier) missing.push('поставщик не указан');
    else if (!analysis.supplier.counterparty_id) missing.push(`поставщик «${analysis.supplier.name}»`);
    for (const l of analysis.lines) if (!l.product_id) missing.push(`«${l.name}»`);
    return {
      entry,
      status: 'pending',
      reply: missing.length
        ? `📝 Принято. Нужно сопоставить в системе: ${missing.join(', ')}`
        : '📝 Принято, ждёт проверки в системе',
    };
  }
  const items = itemsFromAnalysis(analysis);
  const allPriced = items.every((i) => i.price > 0);
  try {
    const result = createPrihodFromEntry(entry, {
      counterparty_id: analysis.supplier.counterparty_id,
      department_id: entry.department_id,
      date: entry.doc_date,
      items,
      confirm: !!topic.auto_confirm && allPriced,
    }, null);
    const head = result.confirmed
      ? `✅ Приход №${result.document.number} проведён`
      : `✅ Приход №${result.document.number} создан (черновик)`;
    const tail = allPriced ? '' : '\nЦены не найдены — заполните в системе';
    return {
      entry,
      status: result.confirmed ? 'confirmed' : 'created',
      document: result.document,
      reply: `${head} · ${formatMessageAt(entry.doc_date)} · ${analysis.supplier.counterparty_name}\n${linesSummary(analysis)}${tail}`,
    };
  } catch (e) {
    run("UPDATE telegram_inbox SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?", [e.message, entry.id]);
    return { entry, status: 'error', reply: `⚠️ Не удалось создать приход: ${e.message}` };
  }
}

function processEditedEntry(entry, topic, ctx) {
  const doc = liveDocument(entry);
  if (entry.status === 'created' && doc) {
    if (doc.status !== 'draft') {
      return { entry, status: 'locked', reply: `⚠️ Сообщение изменено, но приход №${doc.number} уже проведён — исправьте в системе` };
    }
    const analysis = analyzeEntry(entry, ctx);
    if (!analysis.ready) {
      return { entry, status: 'pending', reply: `⚠️ Сообщение изменено — проверьте приход №${doc.number} в системе` };
    }
    const prev = getDocument(doc.id, entry.branch_id);
    const prevPrice = new Map((prev?.items || []).map((i) => [`${i.product_id}:${i.variant_id || ''}`, Number(i.price) || 0]));
    const items = itemsFromAnalysis(analysis).map((i) => ({
      ...i,
      price: prevPrice.get(`${i.product_id}:${i.variant_id || ''}`) || i.price,
    }));
    ensureSupplierLinks(entry.branch_id, analysis.supplier.counterparty_id, items);
    updateDocument(doc.id, {
      date: entry.doc_date,
      counterparty_id: analysis.supplier.counterparty_id,
      items,
    }, null, entry.branch_id);
    return { entry, status: 'updated', reply: `✏️ Приход №${doc.number} обновлён\n${linesSummary(analysis)}` };
  }
  if (entry.status === 'ignored') return { entry, status: 'ignored', reply: null };
  if (entry.status === 'created') {
    run("UPDATE telegram_inbox SET status = 'new', document_id = NULL WHERE id = ?", [entry.id]);
  }
  return autoProcessEntry(queryOne('SELECT * FROM telegram_inbox WHERE id = ?', [entry.id]), topic, ctx);
}

/**
 * Сообщение из группы/темы Telegram. Возвращает ответы для отправки в ту же тему.
 * @param {{ chatId, threadId, chatTitle, topicTitle, messageId, fromName, fromUserId, text, date: Date, edited }} input
 */
export function handleIncomingMessage(input) {
  const topic = recordTopic(input);
  if (topic.mode !== 'prihod' || !topic.branch_id || !topic.department_id) return { topic, results: [] };
  const text = String(input.text || '').trim();
  if (!text || text.startsWith('/')) return { topic, results: [] };

  const when = localDateTime(input.date || new Date());
  const parsed = parsePrihodMessage(text);
  const chatId = String(input.chatId);
  const messageId = String(input.messageId);
  const existing = queryAll(
    'SELECT * FROM telegram_inbox WHERE chat_id = ? AND message_id = ? ORDER BY part',
    [chatId, messageId],
  );
  if (existing.length && !input.edited) return { topic, results: [] };
  if (!parsed.groups.length && !existing.length) return { topic, results: [] };

  const ctx = buildMatchContext(topic.branch_id);
  const results = [];

  parsed.groups.forEach((group, part) => {
    const parsedJson = groupJson(group, part === 0 ? parsed.notes : []);
    const prev = existing.find((e) => Number(e.part) === part);
    if (prev) {
      run(`
        UPDATE telegram_inbox SET text = ?, parsed_json = ?, edited = 1, updated_at = datetime('now') WHERE id = ?
      `, [text, parsedJson, prev.id]);
      results.push(processEditedEntry(queryOne('SELECT * FROM telegram_inbox WHERE id = ?', [prev.id]), topic, ctx));
      return;
    }
    const id = uuidv4();
    run(`
      INSERT INTO telegram_inbox (id, branch_id, topic_id, department_id, chat_id, thread_id, message_id, part, source,
        from_name, from_user_id, text, message_at, doc_date, parsed_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'telegram', ?, ?, ?, ?, ?, ?, 'new')
    `, [
      id, topic.branch_id, topic.id, topic.department_id, chatId, topic.thread_id, messageId, part,
      input.fromName || null, input.fromUserId ? String(input.fromUserId) : null,
      text, when.at, when.date, parsedJson,
    ]);
    results.push(autoProcessEntry(queryOne('SELECT * FROM telegram_inbox WHERE id = ?', [id]), topic, ctx));
  });

  for (const stale of existing.filter((e) => Number(e.part) >= parsed.groups.length && e.status !== 'created')) {
    run("UPDATE telegram_inbox SET status = 'ignored', updated_at = datetime('now') WHERE id = ?", [stale.id]);
  }

  return { topic, results };
}

// ── Входящие (UI) ─────────────────────────────────────────────────────

const INBOX_STATUSES = new Set(['new', 'error', 'created', 'ignored']);

export function listInbox(branchId, filters = {}) {
  const params = [branchId];
  let where = 'i.branch_id = ?';
  if (filters.status === 'pending') {
    where += " AND i.status IN ('new', 'error')";
  } else if (INBOX_STATUSES.has(filters.status)) {
    where += ' AND i.status = ?';
    params.push(filters.status);
  }
  if (filters.date_from) {
    where += ' AND i.doc_date >= ?';
    params.push(String(filters.date_from).slice(0, 10));
  }
  if (filters.date_to) {
    where += ' AND i.doc_date <= ?';
    params.push(String(filters.date_to).slice(0, 10));
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 1000);
  params.push(limit);

  const rows = queryAll(`
    SELECT i.*, t.title as topic_title, t.chat_title,
           d.number as document_number, d.status as document_status, d.total_amount as document_total,
           dep.name as department_name
    FROM telegram_inbox i
    LEFT JOIN telegram_topics t ON t.id = i.topic_id
    LEFT JOIN documents d ON d.id = i.document_id
    LEFT JOIN departments dep ON dep.id = i.department_id
    WHERE ${where}
    ORDER BY i.doc_date DESC, i.message_at DESC, i.created_at DESC, i.part
    LIMIT ?
  `, params);

  const ctx = buildMatchContext(branchId);
  const items = rows.map((row) => ({
    ...enrichInboxRow(row),
    analysis: analyzeEntry(row, ctx),
  }));
  const counts = Object.fromEntries(
    queryAll('SELECT status, COUNT(*) as c FROM telegram_inbox WHERE branch_id = ? GROUP BY status', [branchId])
      .map((r) => [r.status, Number(r.c) || 0]),
  );
  return { items, counts };
}

function getEntry(id, branchId) {
  const entry = queryOne('SELECT * FROM telegram_inbox WHERE id = ? AND branch_id = ?', [id, branchId]);
  if (!entry) throw new Error('Сообщение не найдено');
  return entry;
}

/** Ручное создание прихода из сообщения + запоминание сопоставлений. */
export function createFromInbox(id, payload, userId, branchId) {
  const entry = getEntry(id, branchId);
  if (entry.status === 'ignored') throw new Error('Сообщение пропущено — сначала верните его');
  if (entry.status === 'created' && liveDocument(entry)) throw new Error('По этому сообщению приход уже создан');
  const parsed = readParsed(entry);
  if (!payload.counterparty_id) throw new Error('Выберите поставщика');
  assertDepartmentInBranch(payload.department_id || entry.department_id, branchId);
  if (!(payload.items || []).some((i) => i.product_id)) throw new Error('Сопоставьте хотя бы один товар');

  // «Новый вариант» из окна разбора: добавляем вариант товару и приходуем на него
  const items = (payload.items || []).map((item) => {
    const variantName = String(item.new_variant_name || '').trim();
    if (!variantName || !item.product_id) return item;
    const variant = addProductVariant(item.product_id, variantName, branchId);
    return { ...item, variant_id: variant.id };
  });

  if (payload.remember !== false) {
    if (parsed.supplier) {
      saveAlias(branchId, 'supplier', matchKey(parsed.supplier.name), payload.counterparty_id, null, userId);
    }
    for (const item of items) {
      const line = parsed.lines[Number(item.line_index)];
      if (line && item.product_id) {
        saveAlias(branchId, 'product', matchKey(line.name), item.product_id, item.variant_id || null, userId);
      }
    }
  }

  return createPrihodFromEntry(entry, { ...payload, items }, userId);
}

/** Создать черновики по всем полностью распознанным сообщениям. */
export function createReadyFromInbox(branchId, userId, ids = null) {
  const params = [branchId];
  let sql = "SELECT * FROM telegram_inbox WHERE branch_id = ? AND status IN ('new', 'error')";
  if (Array.isArray(ids) && ids.length) {
    sql += ` AND id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  sql += ' ORDER BY doc_date, message_at, part';
  const ctx = buildMatchContext(branchId);
  const created = [];
  const skipped = [];
  for (const entry of queryAll(sql, params)) {
    const analysis = analyzeEntry(entry, ctx);
    if (!analysis.ready) {
      skipped.push(entry.id);
      continue;
    }
    try {
      const result = createPrihodFromEntry(entry, {
        counterparty_id: analysis.supplier.counterparty_id,
        department_id: entry.department_id,
        date: entry.doc_date,
        items: itemsFromAnalysis(analysis),
      }, userId);
      created.push({ id: entry.id, document_id: result.document.id, number: result.document.number });
    } catch (e) {
      run("UPDATE telegram_inbox SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?", [e.message, entry.id]);
      skipped.push(entry.id);
    }
  }
  return { created, skipped: skipped.length };
}

export function setInboxStatus(id, status, branchId) {
  const entry = getEntry(id, branchId);
  if (status === 'ignored') {
    if (entry.status === 'created' && liveDocument(entry)) {
      throw new Error('По сообщению уже создан приход — удалите приход, если он не нужен');
    }
  } else if (status !== 'new') {
    throw new Error('Неверный статус');
  }
  run(`
    UPDATE telegram_inbox SET status = ?, document_id = NULL, error = NULL, updated_at = datetime('now') WHERE id = ?
  `, [status, id]);
  return { ok: true };
}

/** Вставка текста, скопированного из Telegram (сообщения до подключения бота). */
export function importPastedText(branchId, { text, department_id: departmentId, date }) {
  assertDepartmentInBranch(departmentId, branchId);
  const fallbackDate = String(date || localDateTime(new Date()).date).slice(0, 10);
  const messages = splitPastedTelegramText(text);
  let added = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const msg of messages) {
    const docDate = msg.date || fallbackDate;
    const parsed = parsePrihodMessage(msg.text);
    if (!parsed.groups.length) {
      skipped += 1;
      continue;
    }
    const messageAt = msg.time ? `${docDate}T${msg.time}` : null;
    const messageId = `paste:${createHash('sha1')
      .update(`${branchId}|${docDate}|${msg.time || ''}|${msg.author || ''}|${msg.text}`)
      .digest('hex')
      .slice(0, 20)}`;
    if (queryOne('SELECT id FROM telegram_inbox WHERE chat_id = ? AND message_id = ?', ['paste', messageId])) {
      duplicates += 1;
      continue;
    }
    parsed.groups.forEach((group, part) => {
      run(`
        INSERT INTO telegram_inbox (id, branch_id, topic_id, department_id, chat_id, thread_id, message_id, part, source,
          from_name, text, message_at, doc_date, parsed_json, status)
        VALUES (?, ?, NULL, ?, 'paste', '', ?, ?, 'paste', ?, ?, ?, ?, ?, 'new')
      `, [
        uuidv4(), branchId, departmentId, messageId, part, msg.author || null, msg.text, messageAt,
        docDate, groupJson(group, part === 0 ? parsed.notes : []),
      ]);
      added += 1;
    });
  }
  return { added, duplicates, skipped };
}

function aiPhotoTextPreview(group) {
  const head = group.supplier || group.section || 'Фото прихода';
  const lines = (group.items || []).map((i) => {
    const priceBit = i.price != null ? ` · ${formatQty(i.price)}` : '';
    const amountBit = i.amount != null ? ` = ${formatQty(i.amount)}` : '';
    return `${i.name} — ${formatQty(i.quantity)} ${i.unit || ''}${priceBit}${amountBit}`.trim();
  });
  return [head.includes(':') ? head : `${head}:`, ...lines].join('\n');
}

function matchAiGroupItems(group, ctx, supplierId, date) {
  const matchedItems = [];
  const pendingItems = [];
  for (const line of group.items || []) {
    const m = matchProduct(ctx, line.name, supplierId);
    if (!m.match) {
      pendingItems.push({
        name: line.name,
        quantity: line.quantity,
        unit: line.unit,
        price: line.price,
        amount: line.amount,
      });
      continue;
    }
    const qty = convertQuantity(
      { quantity: line.quantity, unit: line.unit, pieces: null },
      m.match.unit,
    );
    let price = line.price != null && Number.isFinite(line.price) && line.price > 0
      ? line.price
      : ctx.priceFor(supplierId, date, m.match.product_id, m.match.variant_id);
    const row = {
      product_id: m.match.product_id,
      variant_id: m.match.variant_id,
      quantity: qty,
      price: price || 0,
      ai_confirmed: 0,
      ai_raw_name: line.name,
    };
    if (line.amount != null && Number.isFinite(line.amount) && line.amount > 0) {
      row.amount = line.amount;
    }
    matchedItems.push(row);
  }
  return { matchedItems, pendingItems };
}

/**
 * Фото из темы прихода → OpenRouter vision → умный приход:
 * несколько поставщиков/блоков → отдельные черновики; цены/суммы; доп. расходы.
 */
export async function handleIncomingPhoto(input) {
  const topic = recordTopic(input);
  if (topic.mode !== 'prihod' || !topic.branch_id || !topic.department_id) {
    return { topic, results: [] };
  }
  if (!isOpenRouterReady()) {
    return {
      topic,
      results: [{
        reply: '📷 Фото получено, но OpenRouter не настроен. Администратор: Telegram → Искусственный интеллект.',
      }],
    };
  }

  const chatId = String(input.chatId);
  const messageId = String(input.messageId);
  const existingParts = queryAll(
    'SELECT * FROM telegram_inbox WHERE chat_id = ? AND message_id = ? ORDER BY part',
    [chatId, messageId],
  );
  if (existingParts.some((e) => e.document_id && liveDocument(e))) {
    return { topic, results: [] };
  }

  const when = localDateTime(input.date || new Date());
  let extraction;
  try {
    extraction = await recognizePrihodPhoto(input.imageBuffer, input.mimeType || 'image/jpeg');
  } catch (e) {
    return {
      topic,
      results: [{ reply: `⚠️ ИИ не смог разобрать фото: ${e.message}` }],
    };
  }

  const groups = Array.isArray(extraction.groups) && extraction.groups.length
    ? extraction.groups
    : (extraction.items?.length
      ? [{ supplier: extraction.supplier, section: null, items: extraction.items }]
      : []);

  if (!groups.length) {
    return {
      topic,
      results: [{ reply: '📷 Фото принято, но позиции не найдены. Проверьте снимок или напишите текстом.' }],
    };
  }

  const ctx = buildMatchContext(topic.branch_id);
  const tgFileId = input.telegramFileId ? String(input.telegramFileId) : null;
  const extras = Array.isArray(extraction.extra_costs) ? extraction.extra_costs : [];
  const results = [];
  let firstCreatedDocId = null;
  let extrasAttached = false;

  // старые части без документа — перезапишем / лишние пометим ignored
  for (const stale of existingParts) {
    if (Number(stale.part) >= groups.length && stale.status !== 'created') {
      run("UPDATE telegram_inbox SET status = 'ignored', updated_at = datetime('now') WHERE id = ?", [stale.id]);
    }
  }

  for (let part = 0; part < groups.length; part += 1) {
    const group = groups[part];
    const supplierName = group.supplier || null;
    const supplierRaw = supplierName ? { raw: supplierName, name: supplierName } : null;
    const supplierMatch = matchSupplier(ctx, supplierRaw);
    const supplierId = supplierMatch.match?.id || null;
    const { matchedItems, pendingItems } = matchAiGroupItems(group, ctx, supplierId, when.date);

    const prev = existingParts.find((e) => Number(e.part) === part);
    const inboxId = prev?.id || uuidv4();
    const parsedJson = JSON.stringify({
      source: 'ai_photo',
      model: extraction.model,
      supplier: supplierRaw,
      section: group.section || null,
      lines: group.items,
      notes: part === 0 && extraction.notes ? [extraction.notes] : [],
      extra_costs: part === 0 ? extras : [],
      total: part === 0 ? extraction.total : null,
      groups_count: groups.length,
    });
    const textPreview = aiPhotoTextPreview(group);

    let mediaMeta = null;
    if (part === 0) {
      try {
        mediaMeta = saveInboxMediaBuffer(inboxId, input.imageBuffer, input.mimeType || 'image/jpeg');
      } catch (e) {
        console.error('Telegram приход: не удалось сохранить фото во входящие:', e.message);
      }
    }

    if (prev) {
      run(`
        UPDATE telegram_inbox
        SET text = ?, parsed_json = ?, from_name = ?, department_id = ?,
            message_at = ?, doc_date = ?, status = 'new', error = NULL, source = 'ai_photo',
            media_file_name = COALESCE(?, media_file_name), media_mime = COALESCE(?, media_mime),
            media_telegram_file_id = COALESCE(?, media_telegram_file_id),
            updated_at = datetime('now')
        WHERE id = ?
      `, [
        textPreview, parsedJson, input.fromName || null, topic.department_id, when.at, when.date,
        mediaMeta?.file_name || null, mediaMeta?.mime_type || null, part === 0 ? tgFileId : null, inboxId,
      ]);
    } else {
      run(`
        INSERT INTO telegram_inbox (id, branch_id, topic_id, department_id, chat_id, thread_id, message_id, part, source,
          from_name, from_user_id, text, message_at, doc_date, parsed_json, status,
          media_file_name, media_mime, media_telegram_file_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai_photo', ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
      `, [
        inboxId, topic.branch_id, topic.id, topic.department_id, chatId,
        input.threadId ? String(input.threadId) : '', messageId, part,
        input.fromName || null, input.fromUserId ? String(input.fromUserId) : null,
        textPreview, when.at, when.date, parsedJson,
        mediaMeta?.file_name || null, mediaMeta?.mime_type || null, part === 0 ? tgFileId : null,
      ]);
    }

    if (!matchedItems.length) {
      const why = supplierId
        ? 'Товары не сопоставлены со справочником'
        : 'ИИ распознал блок, но поставщик/товары не сопоставлены';
      run("UPDATE telegram_inbox SET status = 'error', error = ? WHERE id = ?", [why, inboxId]);
      const pendingList = pendingItems.slice(0, 12)
        .map((p) => `• ${p.name} — ${formatQty(p.quantity)} ${p.unit || ''}`)
        .join('\n');
      const more = pendingItems.length > 12 ? `\n… ещё ${pendingItems.length - 12}` : '';
      results.push({
        status: 'error',
        reply: (
          `🟡 Блок ${part + 1}/${groups.length}`
          + `${supplierName ? ` · ${supplierName}` : ''}: нужно сопоставить вручную\n`
          + `Позиций: ${group.items.length}\n${pendingList}${more}`
        ),
      });
      continue;
    }

    if (supplierId) ensureSupplierLinks(topic.branch_id, supplierId, matchedItems);

    const commentParts = ['🟡 Из Telegram · ИИ'];
    if (input.fromName) commentParts.push(input.fromName);
    commentParts.push(formatMessageAt(when.at));
    if (group.section) commentParts.push(group.section);
    if (part === 0 && extraction.notes) commentParts.push(extraction.notes);
    if (groups.length > 1) commentParts.push(`блок ${part + 1}/${groups.length}`);

    const extraForDoc = (!extrasAttached && extras.length)
      ? extras.map((e) => ({
        title: e.title,
        amount: e.amount,
        capitalize: !!e.capitalize,
      }))
      : undefined;

    try {
      const doc = createDocument({
        type: 'prihod',
        date: when.date,
        counterparty_id: supplierId,
        to_department_id: topic.department_id,
        comment: commentParts.join(' · '),
        items: matchedItems,
        extra_costs: extraForDoc,
        ai_recognized: true,
        ai_pending_items: pendingItems,
      }, null, topic.branch_id);

      if (extraForDoc?.length) extrasAttached = true;
      if (!firstCreatedDocId) firstCreatedDocId = doc.id;

      try {
        const mime = input.mimeType || 'image/jpeg';
        const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : mime.includes('gif') ? '.gif' : '.jpg';
        saveDocumentAttachmentBuffer(doc.id, input.imageBuffer, {
          mimeType: mime,
          originalName: `telegram-${messageId}${groups.length > 1 ? `-p${part}` : ''}${ext}`,
          source: 'telegram',
        });
      } catch (attachErr) {
        console.error('Telegram приход: не удалось сохранить фото к документу:', attachErr.message);
      }

      run(`
        UPDATE telegram_inbox
        SET status = 'created', document_id = ?, error = NULL, updated_at = datetime('now')
        WHERE id = ?
      `, [doc.id, inboxId]);

      const unconfirmed = Number(doc.ai_unconfirmed_count) || matchedItems.length + pendingItems.length;
      const supplierLabel = supplierMatch.match?.name || supplierName || 'поставщик не указан';
      const pendingTail = pendingItems.length
        ? `\n⚠️ Не сопоставлено (${pendingItems.length}): ${pendingItems.slice(0, 5).map((p) => p.name).join(', ')}`
        : '';
      const extrasTail = extraForDoc?.length
        ? `\nДоп. расходы: ${extraForDoc.map((e) => `${e.title} ${formatQty(e.amount)}`).join(', ')}`
        : '';

      results.push({
        status: 'created',
        document: doc,
        reply: (
          `🟡 ИИ · блок ${part + 1}/${groups.length}\n`
          + `✅ Приход №${doc.number} (черновик) · ${supplierLabel}\n`
          + `Позиций: ${matchedItems.length}, неподтв.: ${unconfirmed}`
          + `${pendingTail}${extrasTail}`
        ),
      });
    } catch (e) {
      run("UPDATE telegram_inbox SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?", [
        e.message, inboxId,
      ]);
      results.push({
        status: 'error',
        reply: `⚠️ Блок ${part + 1}: не удалось создать приход — ${e.message}`,
      });
    }
  }

  const created = results.filter((r) => r.status === 'created').length;
  const summary = (
    `📷 Умный приход: блоков ${groups.length}, создано черновиков ${created}`
    + (extraction.total ? `, итог на фото ≈ ${formatQty(extraction.total)}` : '')
    + (extras.length && !extrasAttached ? `\n⚠️ Доп. расходы распознаны, но не привязаны (нет черновика)` : '')
    + `\nПроверьте жёлтые приходы в системе.`
  );

  return {
    topic,
    results: [
      { reply: summary },
      ...results,
    ],
  };
}

