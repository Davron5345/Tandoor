import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

const { queryAll, queryOne, run } = db;

/** Полный снимок документа для `document_history` (по нему строится «было / стало»). */
export function snapshotDocument(docId) {
  const doc = queryOne('SELECT * FROM documents WHERE id = ?', [docId]);
  const items = queryAll(`
    SELECT di.*, p.name as product_name, p.sku, p.unit, pv.name as variant_name
    FROM document_items di
    JOIN products p ON p.id = di.product_id
    LEFT JOIN product_variants pv ON pv.id = di.variant_id
    WHERE di.document_id = ?
    ORDER BY COALESCE(di.sort_order, 0) ASC, di.id ASC
  `, [docId]);
  const extra_costs = queryAll(`
    SELECT * FROM document_extra_costs WHERE document_id = ? ORDER BY COALESCE(sort_order, 0) ASC, id ASC
  `, [docId]);
  const lines = doc?.type === 'opening_balance'
    ? queryAll(
      'SELECT * FROM opening_balance_lines WHERE document_id = ? ORDER BY COALESCE(sort_order, 0) ASC, id ASC',
      [docId],
    )
    : undefined;
  const counterparty = doc?.counterparty_id
    ? queryOne('SELECT * FROM counterparties WHERE id = ?', [doc.counterparty_id])
    : null;
  return JSON.stringify({ document: doc, items, extra_costs, lines, counterparty });
}

export function addDocumentHistory(documentId, action, userId = null) {
  run(`
    INSERT INTO document_history (id, document_id, action, snapshot, changed_by)
    VALUES (?, ?, ?, ?, ?)
  `, [uuidv4(), documentId, action, snapshotDocument(documentId), userId]);
}
