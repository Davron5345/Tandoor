import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_BRANCH_ID, getBranch } from '../branches.js';
import { assertDepartmentInBranch, syncBranchStockFromDepartments } from '../departments.js';
import { setDepartmentStock, syncVariantCatalogStock } from '../inventoryCost.js';
import { getCounterparty } from './counterparties.js';

const { queryAll, queryOne, run, transaction } = db;

export const OPENING_LINE_TYPES = new Set(['stock', 'debtor', 'creditor', 'cash', 'bank']);

function generateDocNumber(branchId = DEFAULT_BRANCH_ID) {
  const rows = queryAll(
    'SELECT number FROM documents WHERE type = ? AND branch_id = ?',
    ['opening_balance', branchId],
  );
  let max = 0;
  for (const row of rows) {
    const n = parseInt(String(row.number).replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

function lineAmount(line) {
  if (line.line_type === 'stock') {
    return (Number(line.quantity) || 0) * (Number(line.unit_cost) || 0);
  }
  return Number(line.amount) || 0;
}

function normalizeLine(raw) {
  const lineType = String(raw.line_type || '').trim();
  if (!OPENING_LINE_TYPES.has(lineType)) {
    throw new Error(`Неизвестный тип строки: ${lineType || '(пусто)'}`);
  }

  const base = {
    line_type: lineType,
    product_id: raw.product_id || null,
    variant_id: raw.variant_id || null,
    department_id: raw.department_id || null,
    counterparty_id: raw.counterparty_id || null,
    quantity: Number(raw.quantity) || 0,
    unit_cost: Number(raw.unit_cost) || 0,
    amount: Number(raw.amount) || 0,
    comment: String(raw.comment || '').trim(),
  };

  if (lineType === 'stock') {
    if (!base.product_id) throw new Error('Укажите товар в строке остатка');
    if (!base.department_id) throw new Error('Укажите склад в строке остатка');
    if (base.quantity < 0) throw new Error('Количество не может быть отрицательным');
    if (base.unit_cost < 0) throw new Error('Себестоимость не может быть отрицательной');
    base.amount = base.quantity * base.unit_cost;
    return base;
  }

  if (lineType === 'debtor' || lineType === 'creditor') {
    if (!base.counterparty_id) throw new Error('Укажите контрагента');
    const cp = getCounterparty(base.counterparty_id, null);
    if (!cp) throw new Error('Контрагент не найден');
    if (lineType === 'debtor' && cp.type !== 'client') {
      throw new Error(`«${cp.name}» — не клиент (дебитор)`);
    }
    if (lineType === 'creditor' && cp.type !== 'supplier') {
      throw new Error(`«${cp.name}» — не поставщик (кредитор)`);
    }
    if (!Number.isFinite(base.amount) || base.amount === 0) {
      throw new Error('Укажите сумму задолженности');
    }
    return base;
  }

  if (base.amount < 0) throw new Error('Сумма кассы/банка не может быть отрицательной');
  return base;
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map(normalizeLine);
}

function calcTotal(lines) {
  return lines.reduce((s, line) => s + lineAmount(line), 0);
}

function insertLines(documentId, lines) {
  lines.forEach((line, index) => {
    run(
      `INSERT INTO opening_balance_lines
        (id, document_id, line_type, product_id, variant_id, department_id, counterparty_id,
         quantity, unit_cost, amount, comment, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        documentId,
        line.line_type,
        line.product_id,
        line.variant_id,
        line.department_id,
        line.counterparty_id,
        line.quantity,
        line.unit_cost,
        line.amount,
        line.comment,
        index,
      ],
    );
  });
}

function loadLines(documentId) {
  return queryAll(`
    SELECT obl.*,
           p.name as product_name,
           p.unit as product_unit,
           pv.name as variant_name,
           d.name as department_name,
           c.name as counterparty_name,
           c.type as counterparty_type
    FROM opening_balance_lines obl
    LEFT JOIN products p ON p.id = obl.product_id
    LEFT JOIN product_variants pv ON pv.id = obl.variant_id
    LEFT JOIN departments d ON d.id = obl.department_id
    LEFT JOIN counterparties c ON c.id = obl.counterparty_id
    WHERE obl.document_id = ?
    ORDER BY obl.sort_order ASC, obl.line_type ASC
  `, [documentId]);
}

export function enrichOpeningBalanceDocument(doc) {
  if (!doc) return null;
  const lines = loadLines(doc.id);
  const totals = {
    stock: 0,
    debtor: 0,
    creditor: 0,
    cash: 0,
    bank: 0,
  };
  for (const line of lines) {
    const amt = line.line_type === 'stock'
      ? (line.quantity || 0) * (line.unit_cost || 0)
      : (line.amount || 0);
    if (totals[line.line_type] !== undefined) totals[line.line_type] += amt;
  }
  return {
    ...doc,
    lines,
    totals,
    type_label: 'Начальное сальдо',
  };
}

function getDocRow(id, branchId = null) {
  if (branchId) {
    return queryOne(
      'SELECT * FROM documents WHERE id = ? AND type = ? AND branch_id = ?',
      [id, 'opening_balance', branchId],
    );
  }
  return queryOne('SELECT * FROM documents WHERE id = ? AND type = ?', [id, 'opening_balance']);
}

export function listOpeningBalanceDocuments(branchId = DEFAULT_BRANCH_ID) {
  const rows = queryAll(`
    SELECT d.*, u.name as created_by_name
    FROM documents d
    LEFT JOIN users u ON u.id = (
      SELECT changed_by FROM document_history WHERE document_id = d.id AND action = 'created' LIMIT 1
    )
    WHERE d.type = 'opening_balance' AND d.branch_id = ?
    ORDER BY d.date DESC, d.created_at DESC
  `, [branchId]);
  return rows.map((doc) => enrichOpeningBalanceDocument(doc));
}

export function getOpeningBalanceDocument(id, branchId = DEFAULT_BRANCH_ID) {
  const doc = getDocRow(id, branchId);
  return enrichOpeningBalanceDocument(doc);
}

function assertEditable(doc) {
  if (!doc) throw new Error('Документ не найден');
  if (doc.status !== 'draft') throw new Error('Редактировать можно только черновик');
}

function applyStockLines(lines, branchId) {
  const touchedProducts = new Set();
  const touchedVariants = new Set();

  for (const line of lines) {
    if (line.line_type !== 'stock') continue;
    assertDepartmentInBranch(line.department_id, branchId);

    const product = queryOne('SELECT id, has_variants FROM products WHERE id = ?', [line.product_id]);
    if (!product) throw new Error('Товар не найден');
    if (product.has_variants && !line.variant_id) {
      throw new Error('Укажите вариант товара');
    }

    setDepartmentStock(
      line.department_id,
      line.product_id,
      line.quantity,
      line.unit_cost,
      line.variant_id,
    );
    touchedProducts.add(line.product_id);
    if (line.variant_id) touchedVariants.add(line.variant_id);
  }

  for (const productId of touchedProducts) {
    syncBranchStockFromDepartments(branchId, productId);
  }
  for (const variantId of touchedVariants) {
    syncVariantCatalogStock(variantId, branchId);
  }
}

function reverseStockLines(lines, branchId) {
  for (const line of lines) {
    if (line.line_type !== 'stock') continue;
    setDepartmentStock(line.department_id, line.product_id, 0, 0, line.variant_id);
    syncBranchStockFromDepartments(branchId, line.product_id);
    if (line.variant_id) syncVariantCatalogStock(line.variant_id, branchId);
  }
}

function addHistory(documentId, action, userId = null) {
  run(
    `INSERT INTO document_history (id, document_id, action, snapshot, changed_by)
     VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), documentId, action, JSON.stringify({ document_id: documentId, action }), userId],
  );
}

export function createOpeningBalanceDocument(data, userId = null, branchId = DEFAULT_BRANCH_ID) {
  if (!getBranch(branchId)) throw new Error('Филиал не найден');

  const date = String(data.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Укажите дату документа');

  const lines = normalizeLines(data.lines || []);
  if (lines.length === 0) throw new Error('Добавьте хотя бы одну строку');

  const id = uuidv4();
  const number = data.number || generateDocNumber(branchId);
  const total = calcTotal(lines);
  const status = data.status === 'confirmed' ? 'confirmed' : 'draft';

  transaction(() => {
    run(
      `INSERT INTO documents
        (id, number, type, date, comment, branch_id, total_amount, status)
       VALUES (?, ?, 'opening_balance', ?, ?, ?, ?, ?)`,
      [id, number, date, String(data.comment || '').trim(), branchId, total, status],
    );
    insertLines(id, lines);
    addHistory(id, 'created', userId);
    if (status === 'confirmed') {
      applyStockLines(lines, branchId);
      addHistory(id, 'confirmed', userId);
    }
  });

  return getOpeningBalanceDocument(id, branchId);
}

export function updateOpeningBalanceDocument(id, data, userId = null, branchId = DEFAULT_BRANCH_ID) {
  const doc = getDocRow(id, branchId);
  assertEditable(doc);

  const date = data.date !== undefined ? String(data.date).slice(0, 10) : doc.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Укажите дату документа');

  const lines = data.lines !== undefined ? normalizeLines(data.lines) : loadLines(id).map((l) => ({
    line_type: l.line_type,
    product_id: l.product_id,
    variant_id: l.variant_id,
    department_id: l.department_id,
    counterparty_id: l.counterparty_id,
    quantity: l.quantity,
    unit_cost: l.unit_cost,
    amount: l.amount,
    comment: l.comment,
  }));

  if (lines.length === 0) throw new Error('Добавьте хотя бы одну строку');
  const total = calcTotal(lines);

  transaction(() => {
    run(
      `UPDATE documents SET date = ?, comment = ?, total_amount = ?, updated_at = datetime('now') WHERE id = ?`,
      [date, String(data.comment ?? doc.comment ?? '').trim(), total, id],
    );
    run('DELETE FROM opening_balance_lines WHERE document_id = ?', [id]);
    insertLines(id, lines);
    addHistory(id, 'updated', userId);
  });

  return getOpeningBalanceDocument(id, branchId);
}

export function confirmOpeningBalanceDocument(id, userId = null, branchId = DEFAULT_BRANCH_ID) {
  const doc = getDocRow(id, branchId);
  if (!doc) throw new Error('Документ не найден');
  if (doc.status !== 'draft') throw new Error('Провести можно только черновик');

  const lines = loadLines(id);
  if (lines.length === 0) throw new Error('Нет строк для проведения');

  transaction(() => {
    run(`UPDATE documents SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?`, [id]);
    applyStockLines(lines, branchId);
    addHistory(id, 'confirmed', userId);
  });

  return getOpeningBalanceDocument(id, branchId);
}

export function cancelOpeningBalanceDocument(id, userId = null, branchId = DEFAULT_BRANCH_ID) {
  const doc = getDocRow(id, branchId);
  if (!doc) throw new Error('Документ не найден');
  if (doc.status !== 'confirmed') throw new Error('Отменить можно только проведённый документ');

  const lines = loadLines(id);

  transaction(() => {
    run(`UPDATE documents SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [id]);
    reverseStockLines(lines, branchId);
    addHistory(id, 'cancelled', userId);
  });

  return getOpeningBalanceDocument(id, branchId);
}

export function deleteOpeningBalanceDocument(id, branchId = DEFAULT_BRANCH_ID) {
  const doc = getDocRow(id, branchId);
  if (!doc) throw new Error('Документ не найден');
  if (doc.status !== 'draft') throw new Error('Удалить можно только черновик');

  transaction(() => {
    run('DELETE FROM opening_balance_lines WHERE document_id = ?', [id]);
    run('DELETE FROM document_history WHERE document_id = ?', [id]);
    run('DELETE FROM documents WHERE id = ?', [id]);
  });

  return { ok: true };
}

/** Суммы из проведённых документов начального сальдо */
export function getConfirmedOpeningTotals(branchId = DEFAULT_BRANCH_ID) {
  const row = queryOne(`
    SELECT
      COALESCE(SUM(CASE WHEN obl.line_type = 'stock' THEN obl.quantity * obl.unit_cost ELSE 0 END), 0) as stock_value,
      COALESCE(SUM(CASE WHEN obl.line_type = 'debtor' THEN obl.amount ELSE 0 END), 0) as debtors,
      COALESCE(SUM(CASE WHEN obl.line_type = 'creditor' THEN obl.amount ELSE 0 END), 0) as creditors,
      COALESCE(SUM(CASE WHEN obl.line_type = 'cash' THEN obl.amount ELSE 0 END), 0) as cash,
      COALESCE(SUM(CASE WHEN obl.line_type = 'bank' THEN obl.amount ELSE 0 END), 0) as bank
    FROM opening_balance_lines obl
    JOIN documents d ON d.id = obl.document_id
    WHERE d.type = 'opening_balance' AND d.status = 'confirmed' AND d.branch_id = ?
  `, [branchId]);

  const startDate = queryOne(`
    SELECT MIN(d.date) as d FROM documents d
    WHERE d.type = 'opening_balance' AND d.status = 'confirmed' AND d.branch_id = ?
  `, [branchId])?.d || null;

  return {
    stock_value: row?.stock_value || 0,
    debtors: row?.debtors || 0,
    creditors: row?.creditors || 0,
    cash: row?.cash || 0,
    bank: row?.bank || 0,
    start_date: startDate,
  };
}

export function getCounterpartyOpeningFromDocs(counterpartyId, branchId, lineType) {
  return queryOne(`
    SELECT COALESCE(SUM(obl.amount), 0) as v
    FROM opening_balance_lines obl
    JOIN documents d ON d.id = obl.document_id
    WHERE d.type = 'opening_balance' AND d.status = 'confirmed' AND d.branch_id = ?
      AND obl.counterparty_id = ? AND obl.line_type = ?
  `, [branchId, counterpartyId, lineType])?.v || 0;
}
