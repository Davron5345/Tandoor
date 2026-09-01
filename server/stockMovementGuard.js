import db from './db.js';

const { queryAll, queryOne } = db;

const STOCK_DOC_TYPES = [
  'prihod',
  'rashod',
  'return_supplier',
  'return_customer',
  'peremeshchenie',
  'razdelka',
  'dish_sale',
  'inventory',
];

const TYPE_LABELS = {
  prihod: 'Приход',
  rashod: 'Расход',
  return_supplier: 'Возврат поставщику',
  return_customer: 'Возврат от клиента',
  peremeshchenie: 'Перемещение',
  razdelka: 'Разделка',
  dish_sale: 'Продажа блюд',
  inventory: 'Инвентаризация',
  opening_balance: 'Начальное сальдо',
};

function variantKey(variantId) {
  return variantId || '';
}

function collectStockKeys(doc, extraLines = null) {
  const keys = [];
  const seen = new Set();
  const push = (productId, variantId, departmentId) => {
    if (!productId || !departmentId) return;
    const id = `${productId}:${variantKey(variantId)}:${departmentId}`;
    if (seen.has(id)) return;
    seen.add(id);
    keys.push({
      product_id: productId,
      variant_id: variantId || null,
      department_id: departmentId,
    });
  };

  if (doc.type === 'opening_balance') {
    const lines = extraLines || queryAll(
      `SELECT product_id, variant_id, department_id
       FROM opening_balance_lines
       WHERE document_id = ? AND line_type = 'stock'`,
      [doc.id],
    );
    for (const line of lines) {
      push(line.product_id, line.variant_id, line.department_id);
    }
    return keys;
  }

  const items = queryAll(
    'SELECT product_id, variant_id FROM document_items WHERE document_id = ?',
    [doc.id],
  );
  const depts = [...new Set([doc.from_department_id, doc.to_department_id].filter(Boolean))];
  for (const item of items) {
    for (const departmentId of depts) {
      push(item.product_id, item.variant_id, departmentId);
    }
  }
  return keys;
}

function findLaterMovement(doc, key, excludeDocumentIds = []) {
  const date = String(doc.date || '').slice(0, 10);
  const created = doc.created_at || '';
  const variant = variantKey(key.variant_id);
  const typePlaceholders = STOCK_DOC_TYPES.map(() => '?').join(',');
  const excludeIds = [doc.id, ...excludeDocumentIds].filter(Boolean);
  const excludePlaceholders = excludeIds.map(() => '?').join(',');

  const laterDoc = queryOne(`
    SELECT d.number, d.type, d.date, p.name as product_name
    FROM documents d
    JOIN document_items di ON di.document_id = d.id
    JOIN products p ON p.id = di.product_id
    WHERE d.status = 'confirmed'
      AND d.id NOT IN (${excludePlaceholders})
      AND d.type IN (${typePlaceholders})
      AND di.product_id = ?
      AND IFNULL(di.variant_id, '') = ?
      AND (d.from_department_id = ? OR d.to_department_id = ?)
      AND (d.date > ? OR (d.date = ? AND d.created_at > ?))
    ORDER BY d.date ASC, d.created_at ASC
    LIMIT 1
  `, [
    ...excludeIds,
    ...STOCK_DOC_TYPES,
    key.product_id,
    variant,
    key.department_id,
    key.department_id,
    date,
    date,
    created,
  ]);
  if (laterDoc) return laterDoc;

  return queryOne(`
    SELECT d.number, d.type, d.date, p.name as product_name
    FROM documents d
    JOIN opening_balance_lines obl ON obl.document_id = d.id
    JOIN products p ON p.id = obl.product_id
    WHERE d.status = 'confirmed'
      AND d.type = 'opening_balance'
      AND d.id != ?
      AND obl.line_type = 'stock'
      AND obl.product_id = ?
      AND IFNULL(obl.variant_id, '') = ?
      AND obl.department_id = ?
      AND (d.date > ? OR (d.date = ? AND d.created_at > ?))
    ORDER BY d.date ASC, d.created_at ASC
    LIMIT 1
  `, [
    doc.id,
    key.product_id,
    variant,
    key.department_id,
    date,
    date,
    created,
  ]);
}

export function assertNoLaterStockMovements(doc, extraLines = null, excludeDocumentIds = []) {
  if (!doc || doc.status !== 'confirmed') return;
  if (doc.type !== 'opening_balance' && !STOCK_DOC_TYPES.includes(doc.type)) return;

  const keys = collectStockKeys(doc, extraLines);
  for (const key of keys) {
    const later = findLaterMovement(doc, key, excludeDocumentIds);
    if (!later) continue;
    const typeName = TYPE_LABELS[later.type] || later.type;
    const name = later.product_name || 'товар';
    throw new Error(
      `Нельзя отменить: после этого документа есть движение «${name}» (${typeName} №${later.number} от ${String(later.date).slice(0, 10)}). Сначала отмените более поздние документы.`,
    );
  }
}
