import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';

const { queryAll, queryOne, run } = db;

export const DEFAULT_CONTRACT_ID = '__default__';

export function isSupplierCounterpartyDoc(type) {
  return type === 'prihod' || type === 'return_supplier';
}

export function getCounterparties(type, branchId = DEFAULT_BRANCH_ID) {
  let sql = 'SELECT * FROM counterparties WHERE branch_id = ?';
  const params = [branchId];
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  sql += ' ORDER BY type, name';
  return enrichCounterpartiesWithFirms(queryAll(sql, params), branchId);
}

export function getCounterparty(id, branchId = null) {
  if (branchId) {
    return queryOne('SELECT * FROM counterparties WHERE id = ? AND branch_id = ?', [id, branchId]);
  }
  return queryOne('SELECT * FROM counterparties WHERE id = ?', [id]);
}

export function assertCounterpartyBranch(counterpartyId, branchId, docType = null) {
  if (!counterpartyId) return;
  const cp = queryOne('SELECT id, type, branch_id FROM counterparties WHERE id = ?', [counterpartyId]);
  if (!cp) throw new Error('Контрагент не найден');
  if (cp.branch_id !== branchId) throw new Error('Контрагент принадлежит другому филиалу');
  if (isSupplierCounterpartyDoc(docType) && cp.type !== 'supplier') {
    throw new Error('Для прихода/возврата нужен поставщик');
  }
  if (docType === 'rashod' && cp.type !== 'client') throw new Error('Для расхода нужен клиент');
  if (docType === 'return_customer' && cp.type !== 'client') throw new Error('Для возврата нужен клиент');
}

export function createCounterparty(data, branchId = DEFAULT_BRANCH_ID) {
  const id = uuidv4();
  const openingBalance = Number(data.opening_balance);
  const safeOpening = Number.isFinite(openingBalance) ? openingBalance : 0;
  run(`
    INSERT INTO counterparties (id, name, type, phone, email, telegram_chat_id, address, notes, branch_id, opening_balance, inn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, data.name, data.type, data.phone || '', data.email || '',
    data.telegram_chat_id || '', data.address || '', data.notes || '', branchId, safeOpening,
    normalizeCounterpartyInn(data.inn),
  ]);
  return queryOne('SELECT * FROM counterparties WHERE id = ?', [id]);
}

function normalizeCounterpartyInn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 9 ? digits : (value ? String(value).trim() : null);
}

export function updateCounterparty(id, data, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCounterparty(id, branchId);
  if (!existing) throw new Error('Контрагент не найден');
  const openingBalance = data.opening_balance !== undefined
    ? Number(data.opening_balance)
    : (existing.opening_balance || 0);
  if (!Number.isFinite(openingBalance)) throw new Error('Некорректное начальное сальдо');
  const inn = data.inn !== undefined ? normalizeCounterpartyInn(data.inn) : existing.inn;
  run(`
    UPDATE counterparties
    SET name=?, type=?, phone=?, email=?, telegram_chat_id=?, address=?, notes=?,
        opening_balance=?, inn=?, updated_at=datetime('now')
    WHERE id=? AND branch_id=?
  `, [
    data.name, data.type, data.phone || '', data.email || '',
    data.telegram_chat_id || '', data.address || '', data.notes || '',
    openingBalance, inn, id, branchId,
  ]);
  return queryOne('SELECT * FROM counterparties WHERE id = ?', [id]);
}

export function deleteCounterparty(id, branchId = DEFAULT_BRANCH_ID) {
  const existing = getCounterparty(id, branchId);
  if (!existing) throw new Error('Контрагент не найден');

  const docCount = queryOne(
    'SELECT COUNT(*) as c FROM documents WHERE counterparty_id = ?',
    [id],
  )?.c || 0;
  if (docCount > 0) {
    throw new Error(
      `Нельзя удалить контрагента: он используется в ${docCount} документах. Сначала удалите или переназначьте их.`,
    );
  }

  const payCount = queryOne(
    'SELECT COUNT(*) as c FROM payments WHERE counterparty_id = ?',
    [id],
  )?.c || 0;
  if (payCount > 0) {
    throw new Error(
      `Нельзя удалить контрагента: он используется в ${payCount} платежах. Сначала удалите или переназначьте их.`,
    );
  }

  run('DELETE FROM counterparty_firms WHERE counterparty_id = ? AND branch_id = ?', [id, branchId]);
  run('DELETE FROM counterparty_contracts WHERE counterparty_id = ? AND branch_id = ?', [id, branchId]);
  run('DELETE FROM product_suppliers WHERE supplier_id = ? AND branch_id = ?', [id, branchId]);
  run('DELETE FROM counterparties WHERE id = ? AND branch_id = ?', [id, branchId]);
}

export function getCounterpartyContracts(counterpartyId, branchId = DEFAULT_BRANCH_ID, options = {}) {
  const cp = getCounterparty(counterpartyId, branchId);
  if (!cp) throw new Error('Контрагент не найден');
  const firmId = options.firmId || options.firm_id || null;

  const params = [counterpartyId, branchId];
  let sql = `
    SELECT id, counterparty_id, branch_id, firm_id, number, title, date, end_date, direction, amount,
           is_default, created_at
    FROM counterparty_contracts
    WHERE counterparty_id = ? AND branch_id = ?
  `;
  if (firmId) {
    sql += ' AND firm_id = ?';
    params.push(firmId);
  } else if (options.unassignedOnly) {
    sql += " AND (firm_id IS NULL OR firm_id = '')";
  }
  sql += ' ORDER BY is_default DESC, date DESC, number';

  const contracts = queryAll(sql, params);

  if (contracts.length === 0 && !firmId) {
    return [{
      id: DEFAULT_CONTRACT_ID,
      counterparty_id: counterpartyId,
      branch_id: branchId,
      firm_id: null,
      number: 'Основной договор',
      title: null,
      date: null,
      end_date: null,
      direction: null,
      amount: 0,
      is_default: 1,
      virtual: true,
      is_used: false,
    }];
  }

  const usedRows = queryAll(`
    SELECT DISTINCT contract_id
    FROM documents
    WHERE contract_id IS NOT NULL AND contract_id != ''
      AND counterparty_id = ?
      AND (branch_id = ? OR branch_id IS NULL)
  `, [counterpartyId, branchId]);
  const usedPay = queryAll(`
    SELECT DISTINCT contract_id
    FROM payments
    WHERE contract_id IS NOT NULL AND contract_id != ''
      AND counterparty_id = ?
      AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))
  `, [counterpartyId, branchId, branchId, DEFAULT_BRANCH_ID]);
  const usedIds = new Set([
    ...usedRows.map((r) => r.contract_id),
    ...usedPay.map((r) => r.contract_id),
  ]);

  return contracts.map((c) => ({
    ...c,
    is_used: usedIds.has(c.id),
  }));
}

export function createCounterpartyContract(counterpartyId, data, branchId = DEFAULT_BRANCH_ID) {
  const cp = getCounterparty(counterpartyId, branchId);
  if (!cp) throw new Error('Контрагент не найден');
  const number = (data.number || '').trim();
  if (!number) throw new Error('Укажите номер договора');
  const title = (data.title || data.name || '').trim() || null;
  const direction = normalizeContractDirection(data.direction);
  const amount = Number(data.amount);
  const amountValue = Number.isFinite(amount) && amount >= 0 ? amount : 0;

  const id = uuidv4();
  let firmId = data.firm_id || data.firmId || null;
  if (firmId) {
    const firm = queryOne(
      'SELECT id FROM counterparty_firms WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
      [firmId, counterpartyId, branchId],
    );
    if (!firm) throw new Error('Фирма не найдена у этого поставщика');
  }
  run(`
    INSERT INTO counterparty_contracts
      (id, counterparty_id, branch_id, firm_id, number, title, date, end_date, direction, amount, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    counterpartyId,
    branchId,
    firmId,
    number,
    title,
    data.date || null,
    data.end_date || null,
    direction,
    amountValue,
    data.is_default ? 1 : 0,
  ]);

  // Если у фирмы ещё нет contract_id — поставить этот договор
  if (firmId) {
    const firm = queryOne('SELECT contract_id FROM counterparty_firms WHERE id = ?', [firmId]);
    if (firm && !firm.contract_id) {
      run('UPDATE counterparty_firms SET contract_id = ? WHERE id = ?', [id, firmId]);
    }
  }

  const created = queryOne('SELECT * FROM counterparty_contracts WHERE id = ?', [id]);
  return { ...created, is_used: false, virtual: false };
}

export function updateCounterpartyContract(counterpartyId, contractId, data, branchId = DEFAULT_BRANCH_ID) {
  if (contractId === DEFAULT_CONTRACT_ID) throw new Error('Нельзя изменить основной договор');
  const row = queryOne(
    'SELECT * FROM counterparty_contracts WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [contractId, counterpartyId, branchId],
  );
  if (!row) throw new Error('Договор не найден');

  const number = String(data.number ?? row.number ?? '').trim();
  if (!number) throw new Error('Укажите номер договора');
  const title = data.title !== undefined || data.name !== undefined
    ? ((data.title || data.name || '').trim() || null)
    : row.title;
  const direction = data.direction !== undefined
    ? normalizeContractDirection(data.direction)
    : row.direction;
  const date = data.date !== undefined ? (data.date || null) : row.date;
  const endDate = data.end_date !== undefined ? (data.end_date || null) : row.end_date;
  let amountValue = row.amount || 0;
  if (data.amount !== undefined) {
    const amount = Number(data.amount);
    amountValue = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  }
  let firmId = row.firm_id || null;
  if (data.firm_id !== undefined || data.firmId !== undefined) {
    firmId = data.firm_id || data.firmId || null;
    if (firmId) {
      const firm = queryOne(
        'SELECT id FROM counterparty_firms WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
        [firmId, counterpartyId, branchId],
      );
      if (!firm) throw new Error('Фирма не найдена у этого поставщика');
    }
  }

  run(`
    UPDATE counterparty_contracts
    SET number = ?, title = ?, date = ?, end_date = ?, direction = ?, amount = ?, firm_id = ?
    WHERE id = ? AND counterparty_id = ? AND branch_id = ?
  `, [number, title, date, endDate, direction, amountValue, firmId, contractId, counterpartyId, branchId]);
  return getCounterpartyContracts(counterpartyId, branchId, firmId ? { firmId } : {})
    .find((c) => c.id === contractId)
    || { ...queryOne('SELECT * FROM counterparty_contracts WHERE id = ?', [contractId]), is_used: false, virtual: false };
}

function normalizeContractDirection(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'incoming' || v === 'входящий' || v === 'in') return 'incoming';
  if (v === 'outgoing' || v === 'исходящий' || v === 'out') return 'outgoing';
  return null;
}

export function deleteCounterpartyContract(counterpartyId, contractId, branchId = DEFAULT_BRANCH_ID) {
  if (contractId === DEFAULT_CONTRACT_ID) throw new Error('Нельзя удалить основной договор');
  const row = queryOne(
    'SELECT id FROM counterparty_contracts WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [contractId, counterpartyId, branchId],
  );
  if (!row) throw new Error('Договор не найден');
  const used = queryOne(
    `SELECT id FROM documents
     WHERE contract_id = ? AND counterparty_id = ?
     LIMIT 1`,
    [contractId, counterpartyId],
  );
  if (used) throw new Error('Договор используется в документах и не может быть удалён');
  run('DELETE FROM counterparty_contracts WHERE id = ?', [contractId]);
}

function normalizeFirmInn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 9 ? digits : null;
}

function normalizeBankAccount(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function normalizeMfo(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 5);
  return digits || null;
}

export function getCounterpartyFirms(counterpartyId, branchId = DEFAULT_BRANCH_ID) {
  const cp = getCounterparty(counterpartyId, branchId);
  if (!cp) throw new Error('Контрагент не найден');
  const firms = queryAll(`
    SELECT f.id, f.counterparty_id, f.branch_id, f.name, f.inn, f.bank_account, f.mfo,
           f.contract_id, f.is_default, f.created_at, cc.number as contract_number
    FROM counterparty_firms f
    LEFT JOIN counterparty_contracts cc ON cc.id = f.contract_id
    WHERE f.counterparty_id = ? AND f.branch_id = ?
    ORDER BY f.is_default DESC, f.name
  `, [counterpartyId, branchId]);

  const usedDoc = queryAll(`
    SELECT DISTINCT firm_id FROM documents
    WHERE firm_id IS NOT NULL AND counterparty_id = ?
      AND (branch_id = ? OR branch_id IS NULL)
  `, [counterpartyId, branchId]);
  const usedPay = queryAll(`
    SELECT DISTINCT firm_id FROM payments
    WHERE firm_id IS NOT NULL AND counterparty_id = ?
      AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))
  `, [counterpartyId, branchId, branchId, DEFAULT_BRANCH_ID]);
  const usedIds = new Set([
    ...usedDoc.map((r) => r.firm_id),
    ...usedPay.map((r) => r.firm_id),
  ]);

  const counts = queryAll(`
    SELECT firm_id, COUNT(*) as cnt
    FROM counterparty_contracts
    WHERE counterparty_id = ? AND branch_id = ? AND firm_id IS NOT NULL
    GROUP BY firm_id
  `, [counterpartyId, branchId]);
  const countByFirm = new Map(counts.map((r) => [r.firm_id, Number(r.cnt) || 0]));

  return firms.map((f) => ({
    ...f,
    is_used: usedIds.has(f.id),
    contracts_count: countByFirm.get(f.id) || 0,
  }));
}

export function findCounterpartyFirmByInn(inn, branchId = DEFAULT_BRANCH_ID) {
  const normalized = normalizeFirmInn(inn);
  if (!normalized) return null;
  return queryOne(`
    SELECT f.*, c.name as counterparty_name, c.type as counterparty_type
    FROM counterparty_firms f
    JOIN counterparties c ON c.id = f.counterparty_id
    WHERE f.branch_id = ? AND f.inn = ?
    LIMIT 1
  `, [branchId, normalized]);
}

export function createCounterpartyFirm(counterpartyId, data, branchId = DEFAULT_BRANCH_ID) {
  const cp = getCounterparty(counterpartyId, branchId);
  if (!cp) throw new Error('Контрагент не найден');
  if (cp.type !== 'supplier' && cp.type !== 'client') {
    throw new Error('Фирмы доступны у поставщиков и клиента «Клиент»');
  }
  const name = (data.name || '').trim();
  if (!name) throw new Error('Укажите название юрлица');
  const inn = normalizeFirmInn(data.inn);
  if (inn) {
    const dup = findCounterpartyFirmByInn(inn, branchId);
    if (dup) throw new Error(`ИНН ${inn} уже используется у «${dup.counterparty_name}» (${dup.name})`);
  }
  if (data.contract_id) {
    const contract = queryOne(
      'SELECT id FROM counterparty_contracts WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
      [data.contract_id, counterpartyId, branchId],
    );
    if (!contract) throw new Error('Договор не найден у этого контрагента');
  }

  const id = uuidv4();
  const isDefault = data.is_default ? 1 : 0;
  const bankAccount = normalizeBankAccount(data.bank_account);
  const mfo = normalizeMfo(data.mfo);
  if (isDefault) {
    run('UPDATE counterparty_firms SET is_default = 0 WHERE counterparty_id = ? AND branch_id = ?', [
      counterpartyId, branchId,
    ]);
  }
  run(`
    INSERT INTO counterparty_firms
      (id, counterparty_id, branch_id, name, inn, bank_account, mfo, contract_id, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, counterpartyId, branchId, name, inn, bankAccount, mfo, data.contract_id || null, isDefault]);

  return getCounterpartyFirms(counterpartyId, branchId).find((f) => f.id === id);
}

export function updateCounterpartyFirm(counterpartyId, firmId, data, branchId = DEFAULT_BRANCH_ID) {
  const row = queryOne(
    'SELECT * FROM counterparty_firms WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [firmId, counterpartyId, branchId],
  );
  if (!row) throw new Error('Фирма не найдена');
  const name = (data.name ?? row.name).trim();
  if (!name) throw new Error('Укажите название юрлица');
  const inn = data.inn !== undefined ? normalizeFirmInn(data.inn) : row.inn;
  if (inn) {
    const dup = findCounterpartyFirmByInn(inn, branchId);
    if (dup && dup.id !== firmId) {
      throw new Error(`ИНН ${inn} уже используется у «${dup.counterparty_name}» (${dup.name})`);
    }
  }
  const contractId = data.contract_id !== undefined ? (data.contract_id || null) : row.contract_id;
  if (contractId) {
    const contract = queryOne(
      'SELECT id FROM counterparty_contracts WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
      [contractId, counterpartyId, branchId],
    );
    if (!contract) throw new Error('Договор не найден у этого контрагента');
  }
  const bankAccount = data.bank_account !== undefined
    ? normalizeBankAccount(data.bank_account)
    : row.bank_account;
  const mfo = data.mfo !== undefined ? normalizeMfo(data.mfo) : row.mfo;
  const isDefault = data.is_default !== undefined
    ? (data.is_default ? 1 : 0)
    : (row.is_default || 0);
  if (isDefault) {
    run('UPDATE counterparty_firms SET is_default = 0 WHERE counterparty_id = ? AND branch_id = ?', [
      counterpartyId, branchId,
    ]);
  }
  run(`
    UPDATE counterparty_firms
    SET name = ?, inn = ?, bank_account = ?, mfo = ?, contract_id = ?, is_default = ?
    WHERE id = ? AND counterparty_id = ? AND branch_id = ?
  `, [name, inn, bankAccount, mfo, contractId, isDefault, firmId, counterpartyId, branchId]);
  return getCounterpartyFirms(counterpartyId, branchId).find((f) => f.id === firmId);
}

export function deleteCounterpartyFirm(counterpartyId, firmId, branchId = DEFAULT_BRANCH_ID) {
  const row = queryOne(
    'SELECT id FROM counterparty_firms WHERE id = ? AND counterparty_id = ? AND branch_id = ?',
    [firmId, counterpartyId, branchId],
  );
  if (!row) throw new Error('Фирма не найдена');
  const usedDoc = queryOne('SELECT id FROM documents WHERE firm_id = ? LIMIT 1', [firmId]);
  const usedPay = queryOne('SELECT id FROM payments WHERE firm_id = ? LIMIT 1', [firmId]);
  if (usedDoc || usedPay) {
    throw new Error('Фирма используется в документах или оплатах и не может быть удалена');
  }
  run('DELETE FROM counterparty_firms WHERE id = ?', [firmId]);
}

export function enrichCounterpartiesWithFirms(rows, branchId = DEFAULT_BRANCH_ID) {
  const firms = queryAll(`
    SELECT counterparty_id, id, name, inn, is_default
    FROM counterparty_firms
    WHERE branch_id = ?
    ORDER BY is_default DESC, name
  `, [branchId]);
  const byCp = new Map();
  for (const f of firms) {
    if (!byCp.has(f.counterparty_id)) byCp.set(f.counterparty_id, []);
    byCp.get(f.counterparty_id).push(f);
  }

  const docCounts = queryAll(`
    SELECT counterparty_id, COUNT(*) as c
    FROM documents
    WHERE counterparty_id IS NOT NULL AND counterparty_id != ''
      AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))
    GROUP BY counterparty_id
  `, [branchId, branchId, DEFAULT_BRANCH_ID]);
  const payCounts = queryAll(`
    SELECT counterparty_id, COUNT(*) as c
    FROM payments
    WHERE counterparty_id IS NOT NULL AND counterparty_id != ''
      AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))
    GROUP BY counterparty_id
  `, [branchId, branchId, DEFAULT_BRANCH_ID]);
  const docsByCp = new Map(docCounts.map((r) => [r.counterparty_id, Number(r.c) || 0]));
  const paysByCp = new Map(payCounts.map((r) => [r.counterparty_id, Number(r.c) || 0]));

  return rows.map((cp) => {
    const cpFirms = byCp.get(cp.id) || [];
    const inns = cpFirms.map((f) => f.inn).filter(Boolean);
    const documentsCount = docsByCp.get(cp.id) || 0;
    const paymentsCount = paysByCp.get(cp.id) || 0;
    return {
      ...cp,
      firms: cpFirms,
      firms_count: cpFirms.length,
      firms_label: cpFirms.length
        ? (cpFirms.length === 1 ? (inns[0] || cpFirms[0].name) : `${cpFirms.length} фирмы`)
        : (cp.inn || ''),
      documents_count: documentsCount,
      payments_count: paymentsCount,
      mentions_count: documentsCount + paymentsCount,
    };
  });
}
