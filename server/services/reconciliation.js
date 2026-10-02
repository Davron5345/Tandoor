import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { DEFAULT_CONTRACT_ID } from './counterparties.js';

const { queryAll, queryOne } = db;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DOC_OPERATIONS = {
  supplier: {
    prihod: { operation: 'Приход', side: 'debit' },
    return_supplier: { operation: 'Возврат поставщику', side: 'credit' },
  },
  client: {
    rashod: { operation: 'Расход клиенту', side: 'debit' },
    return_customer: { operation: 'Возврат от клиента', side: 'credit' },
  },
};

const PAYMENT_TYPE = { supplier: 'supplier_payment', client: 'customer_income' };
/** Деньги в обратную сторону — увеличивают сальдо (см. COUNTERPARTY_REFUND_TYPE в reports.js). */
const REFUND = {
  supplier: { type: 'other_income', operation: 'Возврат денег от поставщика' },
  client: { type: 'other_expense', operation: 'Выдано клиенту' },
};

function docMatchesContract(doc, contractId) {
  if (!contractId) return true;
  if (contractId === DEFAULT_CONTRACT_ID) return !doc.contract_id || doc.contract_id === DEFAULT_CONTRACT_ID;
  return doc.contract_id === contractId;
}

/**
 * Акт сверки с контрагентом: документы и оплаты филиала.
 * `opening` — сальдо на начало периода (начальное сальдо + все движения до `date_from`).
 */
export function getReconciliationAct(branchId = DEFAULT_BRANCH_ID, filters = {}) {
  const counterpartyId = filters.counterparty_id;
  if (!counterpartyId) throw new Error('Выберите контрагента');
  const dateFrom = filters.date_from || null;
  const dateTo = filters.date_to || null;
  if ((dateFrom && !DATE_RE.test(dateFrom)) || (dateTo && !DATE_RE.test(dateTo))) {
    throw new Error('Некорректная дата');
  }
  const firmId = filters.firm_id || null;
  const contractId = filters.contract_id || null;

  const cp = queryOne('SELECT id, name, type, opening_balance FROM counterparties WHERE id = ? AND branch_id = ?', [
    counterpartyId,
    branchId,
  ]);
  if (!cp) throw new Error('Контрагент не найден');
  const kind = cp.type === 'supplier' ? 'supplier' : 'client';
  const docOps = DOC_OPERATIONS[kind];
  const docTypes = Object.keys(docOps);

  let initial = 0;
  // Начальное сальдо — по контрагенту целиком; при фильтре по договору/фирме не учитываем
  if (!firmId && !contractId) {
    const obRow = queryOne(`
      SELECT COALESCE(SUM(obl.amount), 0) AS amount
      FROM opening_balance_lines obl
      JOIN documents d ON d.id = obl.document_id
      WHERE d.type = 'opening_balance' AND d.status = 'confirmed' AND d.branch_id = ?
        AND obl.counterparty_id = ? AND obl.line_type = ?
    `, [branchId, counterpartyId, kind === 'client' ? 'debtor' : 'creditor']);
    initial = (Number(cp.opening_balance) || 0) + (Number(obRow?.amount) || 0);
  }

  const docs = queryAll(`
    SELECT id, number, type, date, created_at, total_amount, contract_id, firm_id
    FROM documents
    WHERE branch_id = ? AND counterparty_id = ? AND status = 'confirmed'
      AND type IN (${docTypes.map(() => '?').join(', ')})
      ${dateTo ? 'AND date <= ?' : ''}
  `, [branchId, counterpartyId, ...docTypes, ...(dateTo ? [dateTo] : [])])
    .filter((d) => docMatchesContract(d, contractId) && (!firmId || d.firm_id === firmId));
  const matchedDocIds = new Set(docs.map((d) => d.id));

  const pays = queryAll(`
    SELECT p.id, p.number, p.date, p.created_at, p.amount, p.firm_id, p.contract_id, p.document_id, p.type
    FROM payments p
    LEFT JOIN documents d ON d.id = p.document_id
    WHERE (p.branch_id = ? OR (p.branch_id IS NULL AND ? = ?))
      AND (
        (p.type = ? AND (
          (p.document_id IS NOT NULL AND d.id IS NOT NULL AND d.status = 'confirmed' AND d.counterparty_id = ?)
          OR (p.document_id IS NULL AND p.counterparty_id = ?)
        ))
        OR (p.type = ? AND p.document_id IS NULL AND p.counterparty_id = ?)
      )
      ${dateTo ? 'AND p.date <= ?' : ''}
  `, [
    branchId,
    branchId,
    DEFAULT_BRANCH_ID,
    PAYMENT_TYPE[kind],
    counterpartyId,
    counterpartyId,
    REFUND[kind].type,
    counterpartyId,
    ...(dateTo ? [dateTo] : []),
  ]).filter((p) => {
    if (contractId) {
      const byDoc = p.document_id && matchedDocIds.has(p.document_id);
      const byContract = !p.document_id && p.contract_id === contractId;
      if (!byDoc && !byContract) return false;
    }
    if (firmId && p.firm_id !== firmId) return false;
    return true;
  });

  const movements = [
    ...docs.map((d) => {
      const op = docOps[d.type];
      const amount = Number(d.total_amount) || 0;
      return {
        docId: d.id,
        date: d.date,
        created_at: d.created_at,
        ref: `Документ №${d.number}`,
        operation: op.operation,
        debit: op.side === 'debit' ? amount : 0,
        credit: op.side === 'credit' ? amount : 0,
      };
    }),
    ...pays.map((p) => {
      const amount = Number(p.amount) || 0;
      const isRefund = p.type === REFUND[kind].type;
      return {
        paymentId: p.id,
        date: p.date,
        created_at: p.created_at,
        ref: `Оплата №${p.number}`,
        operation: isRefund
          ? REFUND[kind].operation
          : (kind === 'supplier' ? 'Оплата поставщику' : 'Оплата от клиента'),
        debit: isRefund ? amount : 0,
        credit: isRefund ? 0 : amount,
      };
    }),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));

  let opening = initial;
  const rows = [];
  for (const m of movements) {
    if (dateFrom && m.date < dateFrom) {
      opening += m.debit - m.credit;
      continue;
    }
    const row = { ...m };
    delete row.created_at;
    rows.push(row);
  }

  return {
    counterparty: { id: cp.id, name: cp.name, type: cp.type },
    initial_balance: Math.round(initial * 100) / 100,
    opening: Math.round(opening * 100) / 100,
    rows,
  };
}
