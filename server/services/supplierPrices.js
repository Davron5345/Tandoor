import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';

const { queryAll, queryOne, run, transaction } = db;

export const SUPPLIER_PRICE_TYPE = 'supplier_price';

function generateDocNumber(branchId = DEFAULT_BRANCH_ID) {
  const rows = queryAll(
    'SELECT number FROM documents WHERE type = ? AND branch_id = ?',
    [SUPPLIER_PRICE_TYPE, branchId],
  );
  let max = 0;
  for (const row of rows) {
    const n = parseInt(String(row.number).replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

function priceKey(productId, variantId = null) {
  return variantId ? `v:${variantId}` : productId;
}

function normalizeItems(items) {
  const out = [];
  const seen = new Set();
  for (const raw of items || []) {
    const productId = raw.product_id || null;
    if (!productId) continue;
    const variantId = raw.variant_id || null;
    const price = Number(raw.price);
    if (!(price >= 0)) throw new Error('Укажите корректную цену');
    const key = priceKey(productId, variantId);
    if (seen.has(key)) continue;
    seen.add(key);
    const product = queryOne('SELECT id, name FROM products WHERE id = ?', [productId]);
    if (!product) throw new Error('Товар не найден');
    if (variantId) {
      const variant = queryOne(
        'SELECT id FROM product_variants WHERE id = ? AND product_id = ? AND COALESCE(archived, 0) = 0',
        [variantId, productId],
      );
      if (!variant) throw new Error(`Вариант не найден для «${product.name}»`);
    }
    out.push({
      product_id: productId,
      variant_id: variantId,
      price,
      quantity: 1,
      amount: price,
    });
  }
  if (!out.length) throw new Error('Добавьте хотя бы один товар с ценой');
  return out;
}

function assertSupplier(counterpartyId, branchId) {
  if (!counterpartyId) throw new Error('Выберите поставщика');
  const cp = queryOne(
    'SELECT id, type, name, branch_id FROM counterparties WHERE id = ?',
    [counterpartyId],
  );
  if (!cp) throw new Error('Поставщик не найден');
  if (cp.type !== 'supplier') throw new Error('Выберите контрагента типа «поставщик»');
  if ((cp.branch_id || DEFAULT_BRANCH_ID) !== branchId) {
    throw new Error('Нет доступа к поставщику этого филиала');
  }
  return cp;
}

function insertItems(documentId, items) {
  items.forEach((item, idx) => {
    run(
      `INSERT INTO document_items
        (id, document_id, product_id, variant_id, quantity, price, amount, item_role, sort_order)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'input', ?)`,
      [
        uuidv4(),
        documentId,
        item.product_id,
        item.variant_id || null,
        item.price,
        item.price,
        idx,
      ],
    );
  });
}

function enrichDoc(doc) {
  if (!doc) return null;
  const items = queryAll(`
    SELECT di.*, p.name as product_name, p.unit, pv.name as variant_name
    FROM document_items di
    JOIN products p ON p.id = di.product_id
    LEFT JOIN product_variants pv ON pv.id = di.variant_id
    WHERE di.document_id = ?
    ORDER BY COALESCE(di.sort_order, 0) ASC, di.id ASC
  `, [doc.id]);
  const total = items.reduce((s, i) => s + (Number(i.amount) || Number(i.price) || 0), 0);
  return {
    ...doc,
    items,
    total_amount: total,
    lines_count: items.length,
  };
}

/**
 * Карта актуальных цен из проведённых прайс-документов поставщика.
 * Берётся последняя цена по дате документа (и created_at).
 */
export function getSupplierPriceMap(branchId, supplierId, asOfDate = null) {
  if (!supplierId) return {};
  let sql = `
    SELECT di.product_id, di.variant_id, di.price
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    WHERE d.type = ?
      AND d.status = 'confirmed'
      AND d.branch_id = ?
      AND d.counterparty_id = ?
  `;
  const params = [SUPPLIER_PRICE_TYPE, branchId, supplierId];
  if (asOfDate) {
    sql += ' AND d.date <= ?';
    params.push(String(asOfDate).slice(0, 10));
  }
  sql += ' ORDER BY d.date DESC, d.created_at DESC, di.id DESC';

  const rows = queryAll(sql, params);
  const map = {};
  for (const row of rows) {
    const key = priceKey(row.product_id, row.variant_id || null);
    if (map[key] === undefined) {
      map[key] = Number(row.price) || 0;
    }
  }
  return map;
}

export function supplierPriceForItem(map, productId, variantId = null) {
  if (!map) return null;
  if (variantId) {
    if (map[`v:${variantId}`] !== undefined) return map[`v:${variantId}`];
  }
  if (map[productId] !== undefined) return map[productId];
  return null;
}

export function listSupplierPriceDocuments(branchId) {
  const docs = queryAll(`
    SELECT d.*, c.name as counterparty_name,
      (SELECT COUNT(*) FROM document_items di WHERE di.document_id = d.id) as lines_count,
      (SELECT COALESCE(SUM(di.amount), 0) FROM document_items di WHERE di.document_id = d.id) as total_amount
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    WHERE d.type = ? AND d.branch_id = ?
    ORDER BY d.date DESC, d.created_at DESC
  `, [SUPPLIER_PRICE_TYPE, branchId]);
  return docs;
}

export function getSupplierPriceDocument(id, branchId) {
  const doc = queryOne(`
    SELECT d.*, c.name as counterparty_name
    FROM documents d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    WHERE d.id = ? AND d.type = ? AND d.branch_id = ?
  `, [id, SUPPLIER_PRICE_TYPE, branchId]);
  return enrichDoc(doc);
}

export function createSupplierPriceDocument(data, userId, branchId) {
  const supplierId = data.counterparty_id;
  assertSupplier(supplierId, branchId);
  const date = String(data.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Укажите дату');
  const items = normalizeItems(data.items);
  const id = uuidv4();
  const number = data.number || generateDocNumber(branchId);
  const comment = String(data.comment || '').trim();

  transaction(() => {
    run(
      `INSERT INTO documents
        (id, number, type, counterparty_id, date, comment, status, branch_id, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        id,
        number,
        SUPPLIER_PRICE_TYPE,
        supplierId,
        date,
        comment || null,
        branchId,
        items.reduce((s, i) => s + i.price, 0),
      ],
    );
    insertItems(id, items);
  });

  return getSupplierPriceDocument(id, branchId);
}

export function updateSupplierPriceDocument(id, data, branchId) {
  const existing = queryOne(
    'SELECT * FROM documents WHERE id = ? AND type = ? AND branch_id = ?',
    [id, SUPPLIER_PRICE_TYPE, branchId],
  );
  if (!existing) throw new Error('Документ не найден');
  if (existing.status === 'confirmed') {
    throw new Error('Проведённый прайс нельзя изменить — отмените проведение');
  }
  if (existing.status === 'cancelled') {
    throw new Error('Отменённый документ нельзя изменить');
  }

  const supplierId = data.counterparty_id ?? existing.counterparty_id;
  assertSupplier(supplierId, branchId);
  const date = String(data.date ?? existing.date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Укажите дату');
  const items = normalizeItems(data.items);
  const comment = data.comment !== undefined
    ? String(data.comment || '').trim()
    : (existing.comment || '');

  transaction(() => {
    run(
      `UPDATE documents
       SET counterparty_id = ?, date = ?, comment = ?, total_amount = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        supplierId,
        date,
        comment || null,
        items.reduce((s, i) => s + i.price, 0),
        id,
      ],
    );
    run('DELETE FROM document_items WHERE document_id = ?', [id]);
    insertItems(id, items);
  });

  return getSupplierPriceDocument(id, branchId);
}

export function confirmSupplierPriceDocument(id, userId, branchId) {
  const existing = queryOne(
    'SELECT * FROM documents WHERE id = ? AND type = ? AND branch_id = ?',
    [id, SUPPLIER_PRICE_TYPE, branchId],
  );
  if (!existing) throw new Error('Документ не найден');
  if (existing.status === 'confirmed') return getSupplierPriceDocument(id, branchId);
  if (existing.status === 'cancelled') throw new Error('Отменённый документ нельзя провести');

  const items = queryAll('SELECT id FROM document_items WHERE document_id = ?', [id]);
  if (!items.length) throw new Error('Добавьте хотя бы один товар с ценой');

  run(
    `UPDATE documents SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?`,
    [id],
  );
  run(
    `INSERT INTO document_history (id, document_id, action, snapshot, changed_by)
     VALUES (?, ?, 'confirmed', ?, ?)`,
    [uuidv4(), id, JSON.stringify({ type: SUPPLIER_PRICE_TYPE }), userId || 'system'],
  );
  return getSupplierPriceDocument(id, branchId);
}

export function cancelSupplierPriceDocument(id, userId, branchId) {
  const existing = queryOne(
    'SELECT * FROM documents WHERE id = ? AND type = ? AND branch_id = ?',
    [id, SUPPLIER_PRICE_TYPE, branchId],
  );
  if (!existing) throw new Error('Документ не найден');
  if (existing.status !== 'confirmed') throw new Error('Отменить можно только проведённый прайс');

  run(
    `UPDATE documents SET status = 'draft', updated_at = datetime('now') WHERE id = ?`,
    [id],
  );
  run(
    `INSERT INTO document_history (id, document_id, action, snapshot, changed_by)
     VALUES (?, ?, 'cancel_to_draft', ?, ?)`,
    [uuidv4(), id, JSON.stringify({ type: SUPPLIER_PRICE_TYPE }), userId || 'system'],
  );
  return getSupplierPriceDocument(id, branchId);
}

export function deleteSupplierPriceDocument(id, branchId) {
  const existing = queryOne(
    'SELECT * FROM documents WHERE id = ? AND type = ? AND branch_id = ?',
    [id, SUPPLIER_PRICE_TYPE, branchId],
  );
  if (!existing) throw new Error('Документ не найден');
  if (existing.status === 'confirmed') {
    throw new Error('Сначала отмените проведение прайса');
  }
  transaction(() => {
    run('DELETE FROM document_history WHERE document_id = ?', [id]);
    run('DELETE FROM document_items WHERE document_id = ?', [id]);
    run('DELETE FROM documents WHERE id = ?', [id]);
  });
  return { ok: true };
}

/**
 * При проведении прихода: создать/обновить прайс-документ на дату+поставщика
 * и записать цены из строк прихода (остальные позиции прайса сохраняются).
 */
export function syncSupplierPriceListFromPrihod(doc, items) {
  if (!doc || doc.type !== 'prihod' || !doc.counterparty_id) return null;
  const branchId = doc.branch_id || DEFAULT_BRANCH_ID;
  const supplierId = doc.counterparty_id;
  const date = String(doc.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const priceLines = [];
  const seen = new Set();
  for (const item of items || []) {
    if (!item.product_id) continue;
    const price = Number(item.price);
    if (!(price >= 0)) continue;
    const key = priceKey(item.product_id, item.variant_id || null);
    if (seen.has(key)) continue;
    seen.add(key);
    priceLines.push({
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      price,
    });
  }
  if (!priceLines.length) return null;

  let priceDoc = queryOne(`
    SELECT * FROM documents
    WHERE type = ? AND branch_id = ? AND counterparty_id = ? AND date = ?
      AND status IN ('draft', 'confirmed')
    ORDER BY CASE status WHEN 'confirmed' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  `, [SUPPLIER_PRICE_TYPE, branchId, supplierId, date]);

  const existingItems = priceDoc
    ? queryAll('SELECT * FROM document_items WHERE document_id = ?', [priceDoc.id])
    : [];
  const merged = new Map();
  for (const row of existingItems) {
    merged.set(priceKey(row.product_id, row.variant_id || null), {
      product_id: row.product_id,
      variant_id: row.variant_id || null,
      price: Number(row.price) || 0,
    });
  }
  for (const line of priceLines) {
    merged.set(priceKey(line.product_id, line.variant_id), line);
  }
  const mergedItems = [...merged.values()];

  const comment = priceDoc?.comment
    || `Авто из прихода №${doc.number || ''}`.trim();

  if (!priceDoc) {
    const id = uuidv4();
    const number = generateDocNumber(branchId);
    run(
      `INSERT INTO documents
        (id, number, type, counterparty_id, date, comment, status, branch_id, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
      [
        id,
        number,
        SUPPLIER_PRICE_TYPE,
        supplierId,
        date,
        comment,
        branchId,
        mergedItems.reduce((s, i) => s + i.price, 0),
      ],
    );
    insertItems(id, mergedItems);
    run(
      `INSERT INTO document_history (id, document_id, action, snapshot, changed_by)
       VALUES (?, ?, 'confirmed', ?, ?)`,
      [
        uuidv4(),
        id,
        JSON.stringify({ via: 'prihod', prihod_id: doc.id }),
        'system',
      ],
    );
    return id;
  }

  run(
    `UPDATE documents
     SET status = 'confirmed', comment = ?, total_amount = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      comment,
      mergedItems.reduce((s, i) => s + i.price, 0),
      priceDoc.id,
    ],
  );
  run('DELETE FROM document_items WHERE document_id = ?', [priceDoc.id]);
  insertItems(priceDoc.id, mergedItems);
  return priceDoc.id;
}
