import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { createPayment } from './payments.js';
import { getCounterparties, getCounterpartyContracts, DEFAULT_CONTRACT_ID } from './counterparties.js';

const { queryOne } = db;

const HEADER_MARKERS = ['дата документа', 'оборот дебет', 'оборот кредит', 'назначение платежа'];

const ACQUIRING_CHANNELS = [
  { id: 'click', label: 'Click', patterns: [/\bCLICK\b/i, /CLICK\s*AJ/i] },
  { id: 'payme', label: 'Payme', patterns: [/\bPAYME\b/i] },
  { id: 'terminal', label: 'Терминал', patterns: [/UNIONPAY/i, /SMARTVISTA/i, /ТЕР:/i, /ТЕРМИНАЛ/i, /ИНКАССАЦ/i] },
];

const COMMISSION_RE = /комиссионн/i;
const OWN_NAME_RE = /MAHALLA|МАХАЛЛ/i;
const CLIENT_NAME_RE = /^клиент$/i;

function normalizeInn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 9) return digits;
  return null;
}

function extractInns(...texts) {
  const found = [];
  const seen = new Set();
  for (const text of texts) {
    const matches = String(text || '').match(/\d{9}/g) || [];
    for (const m of matches) {
      if (!seen.has(m)) {
        seen.add(m);
        found.push(m);
      }
    }
  }
  return found;
}

function parseAmount(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/\s/g, '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseStatementDate(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const month = String(m[2]).padStart(2, '0');
  const day = String(m[1]).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cell(row, idx) {
  if (!row || idx == null || idx < 0) return '';
  const v = row[idx];
  return v == null ? '' : String(v).trim();
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const joined = (rows[i] || []).map((c) => String(c || '').trim().toLowerCase()).join(' | ');
    if (HEADER_MARKERS.every((m) => joined.includes(m))) return i;
  }
  return -1;
}

function mapColumns(headerRow) {
  const map = {};
  (headerRow || []).forEach((h, idx) => {
    const key = String(h || '').trim().toLowerCase();
    if (!key) return;
    if (key.includes('дата')) map.date = idx;
    else if (key === 'счёт' || key === 'счет') map.account = idx;
    else if (key.includes('наименование')) map.name = idx;
    else if (key.includes('номер документа')) map.docNo = idx;
    else if (key.includes('тип документа')) map.docType = idx;
    else if (key.includes('филиал')) map.branch = idx;
    else if (key.includes('оборот дебет')) map.debit = idx;
    else if (key.includes('оборот кредит')) map.credit = idx;
    else if (key.includes('назначение')) map.purpose = idx;
    else if (key.includes('инн')) map.inn = idx;
  });
  return map;
}

function isMetaRow(row, cols) {
  const name = cell(row, cols.name) || cell(row, 0);
  const lower = name.toLowerCase();
  if (!name && !cell(row, cols.date)) return true;
  if (lower.startsWith('счет:') || lower.startsWith('счёт:')) return true;
  if (lower.includes('остаток на начало') || lower.includes('остаток на конец')) return true;
  if (lower.startsWith('итого')) return true;
  if (lower.includes('internet bank') || lower.includes('справка о работе')) return true;
  return false;
}

function detectAcquiringChannel(name, purpose) {
  const text = `${name} ${purpose}`;
  for (const ch of ACQUIRING_CHANNELS) {
    if (ch.patterns.some((re) => re.test(text))) return ch;
  }
  return null;
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/["'«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findRetailClient(counterparties) {
  const clients = counterparties.filter((c) => c.type === 'client');
  return clients.find((c) => CLIENT_NAME_RE.test(String(c.name || '').trim()))
    || clients.find((c) => normalizeName(c.name) === 'клиент')
    || null;
}

function matchContractForChannel(contracts, channel) {
  if (!channel || !contracts?.length) return null;
  const real = contracts.filter((c) => c.id !== DEFAULT_CONTRACT_ID && !c.virtual);
  const keywords = {
    click: ['click', 'клик'],
    payme: ['payme', 'пейм'],
    terminal: ['терминал', 'terminal', 'pos', 'union'],
  }[channel.id] || [channel.label.toLowerCase()];

  for (const kw of keywords) {
    const hit = real.find((c) => normalizeName(c.number).includes(kw));
    if (hit) return hit;
  }
  return null;
}

function buildOwnInns(rawRows) {
  const own = new Set();
  for (const row of rawRows) {
    const name = row.name || '';
    const purpose = row.purpose || '';
    if (COMMISSION_RE.test(name) || OWN_NAME_RE.test(name)) {
      for (const inn of extractInns(name, purpose, row.innCol)) own.add(inn);
    }
  }
  // Known from sample / typical Mahalla9O
  own.add('311330873');
  return own;
}

function pickCounterpartyInn(name, purpose, colInn, ownInns) {
  const fromText = extractInns(name, purpose).filter((inn) => !ownInns.has(inn));
  if (fromText.length) return fromText[fromText.length - 1];
  const fromCol = normalizeInn(colInn);
  if (fromCol && !ownInns.has(fromCol)) return fromCol;
  return null;
}

function matchByInn(counterparties, inn) {
  if (!inn) return null;
  return counterparties.find((c) => normalizeInn(c.inn) === inn) || null;
}

function matchByName(counterparties, name, type = null) {
  const n = normalizeName(name).replace(/\d{9}/g, '').trim();
  if (n.length < 3) return null;
  const list = type ? counterparties.filter((c) => c.type === type) : counterparties;
  let best = null;
  let bestScore = 0;
  for (const cp of list) {
    const cn = normalizeName(cp.name);
    if (!cn) continue;
    if (cn === n) return cp;
    if (n.includes(cn) || cn.includes(n)) {
      const score = Math.min(cn.length, n.length);
      if (score > bestScore) {
        bestScore = score;
        best = cp;
      }
    }
  }
  return bestScore >= 5 ? best : null;
}

function makeExternalRef(parts) {
  const raw = [
    parts.date,
    parts.docNo,
    parts.account,
    parts.debit,
    parts.credit,
    String(parts.purpose || '').slice(0, 120),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

/**
 * Parse Ipak Yuli AccReferenceReport xlsx buffer into raw operation rows.
 */
export function parseAccReferenceReportBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('В файле нет листов');
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    throw new Error('Не найден заголовок выписки AccReferenceReport (Ipak Yuli)');
  }
  const cols = mapColumns(rows[headerIdx]);
  if (cols.date == null || cols.debit == null || cols.credit == null) {
    throw new Error('В выписке нет колонок даты / дебета / кредита');
  }

  const dataRows = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (isMetaRow(row, cols)) continue;
    const date = parseStatementDate(cell(row, cols.date));
    if (!date) continue;
    const debit = parseAmount(row[cols.debit]);
    const credit = parseAmount(row[cols.credit]);
    if (debit <= 0 && credit <= 0) continue;
    dataRows.push({
      date,
      account: cell(row, cols.account),
      name: cell(row, cols.name),
      docNo: cell(row, cols.docNo),
      debit,
      credit,
      purpose: cell(row, cols.purpose),
      innCol: cell(row, cols.inn),
    });
  }
  return { rows: dataRows, cols };
}

function classifyRow(raw, ctx) {
  const {
    counterparties, retailClient, retailContracts, ownInns, existingRefs,
  } = ctx;
  const direction = raw.debit > 0 ? 'debit' : 'credit';
  const amount = direction === 'debit' ? raw.debit : raw.credit;
  const channel = direction === 'credit' ? detectAcquiringChannel(raw.name, raw.purpose) : null;
  const counterpartyInn = pickCounterpartyInn(raw.name, raw.purpose, raw.innCol, ownInns);
  const externalRef = makeExternalRef(raw);
  const alreadyImported = existingRefs.has(externalRef);

  let type = direction === 'debit' ? 'supplier_payment' : 'customer_income';
  let counterparty = null;
  let contract = null;
  let selected = true;
  let matchReason = '';
  let channelId = null;
  let channelLabel = null;

  if (COMMISSION_RE.test(raw.name) || /16401/.test(raw.account)) {
    type = 'other_expense';
    selected = true;
    matchReason = 'комиссия банка';
  } else if (channel) {
    type = 'customer_income';
    channelId = channel.id;
    channelLabel = channel.label;
    counterparty = retailClient;
    contract = matchContractForChannel(retailContracts, channel);
    selected = Boolean(retailClient);
    matchReason = retailClient
      ? (contract
        ? `эквайринг → ${retailClient.name} / ${contract.number}`
        : `эквайринг → ${retailClient.name} (добавьте договор «${channel.label}»)`)
      : 'эквайринг: создайте клиента «КЛИЕНТ» и договоры Click / Payme / Терминал';
  } else if (direction === 'debit') {
    counterparty = matchByInn(counterparties, counterpartyInn)
      || matchByName(counterparties, raw.name, 'supplier');
    if (counterparty?.type === 'client') {
      type = 'other_expense';
      matchReason = counterpartyInn
        ? `возврат/расход клиенту по ИНН ${counterpartyInn}`
        : 'расход клиенту по имени';
    } else {
      type = 'supplier_payment';
      matchReason = counterparty
        ? (counterpartyInn ? `поставщик по ИНН ${counterpartyInn}` : 'поставщик по имени')
        : (counterpartyInn ? `ИНН ${counterpartyInn} не найден в справочнике` : 'поставщик не распознан');
    }
  } else {
    counterparty = matchByInn(counterparties, counterpartyInn)
      || matchByName(counterparties, raw.name, 'client');
    if (counterparty?.type === 'supplier') {
      type = 'other_income';
      matchReason = counterpartyInn
        ? `возврат от поставщика по ИНН ${counterpartyInn}`
        : 'приход от поставщика по имени';
    } else {
      type = 'customer_income';
      matchReason = counterparty
        ? (counterpartyInn ? `клиент по ИНН ${counterpartyInn}` : 'клиент по имени')
        : (counterpartyInn ? `ИНН ${counterpartyInn} не найден` : 'контрагент не распознан');
    }
  }

  if (alreadyImported) {
    selected = false;
    matchReason = `уже загружено (${matchReason})`;
  }

  return {
    external_ref: externalRef,
    date: raw.date,
    direction,
    amount,
    debit: raw.debit,
    credit: raw.credit,
    account: raw.account,
    name: raw.name,
    doc_no: raw.docNo,
    purpose: raw.purpose,
    inn: counterpartyInn,
    type,
    counterparty_id: counterparty?.id || null,
    counterparty_name: counterparty?.name || null,
    contract_id: contract?.id || null,
    contract_number: contract?.number || null,
    channel: channelId,
    channel_label: channelLabel,
    selected,
    already_imported: alreadyImported,
    match_reason: matchReason,
  };
}

/**
 * Parse file and enrich rows with counterparty / contract suggestions for a branch.
 */
export function previewBankStatement(buffer, branchId = DEFAULT_BRANCH_ID) {
  const { rows: rawRows } = parseAccReferenceReportBuffer(buffer);
  const counterparties = getCounterparties(null, branchId);
  const retailClient = findRetailClient(counterparties);
  const retailContracts = retailClient
    ? getCounterpartyContracts(retailClient.id, branchId)
    : [];
  const ownInns = buildOwnInns(rawRows);

  const existingRefs = new Set();
  for (const raw of rawRows) {
    const ref = makeExternalRef(raw);
    const hit = queryOne(
      `SELECT id FROM payments
       WHERE external_ref = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))`,
      [ref, branchId, branchId, DEFAULT_BRANCH_ID],
    );
    if (hit) existingRefs.add(ref);
  }

  const ctx = {
    counterparties, retailClient, retailContracts, ownInns, existingRefs,
  };
  const rows = rawRows.map((r) => classifyRow(r, ctx));

  // Sort: matched counterparties first, then by name/inn, then date
  rows.sort((a, b) => {
    const an = (a.counterparty_name || a.name || '').localeCompare(b.counterparty_name || b.name || '', 'ru');
    if (an !== 0) return an;
    const ai = (a.inn || '').localeCompare(b.inn || '');
    if (ai !== 0) return ai;
    return String(a.date).localeCompare(String(b.date));
  });

  return {
    bank: 'Ipak Yuli',
    format: 'AccReferenceReport',
    retail_client: retailClient
      ? { id: retailClient.id, name: retailClient.name }
      : null,
    total: rows.length,
    selected_count: rows.filter((r) => r.selected).length,
    rows,
  };
}

/**
 * Create payments from confirmed preview rows.
 */
export function confirmBankStatementImport(rows, userId, branchId = DEFAULT_BRANCH_ID, userRole = null) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Нет строк для импорта');
  }
  const batchId = uuidv4();
  const created = [];
  const skipped = [];

  for (const row of rows) {
    if (!row || row.selected === false) {
      skipped.push({ reason: 'не выбрано', external_ref: row?.external_ref });
      continue;
    }
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped.push({ reason: 'некорректная сумма', external_ref: row.external_ref });
      continue;
    }
    if (!row.date) {
      skipped.push({ reason: 'нет даты', external_ref: row.external_ref });
      continue;
    }
    if (row.external_ref) {
      const exists = queryOne(
        `SELECT id FROM payments
         WHERE external_ref = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))`,
        [row.external_ref, branchId, branchId, DEFAULT_BRANCH_ID],
      );
      if (exists) {
        skipped.push({ reason: 'уже загружено', external_ref: row.external_ref, payment_id: exists.id });
        continue;
      }
    }

    const commentParts = [];
    if (row.channel_label) commentParts.push(row.channel_label);
    if (row.contract_number) commentParts.push(`дог. ${row.contract_number}`);
    if (row.doc_no) commentParts.push(`№${row.doc_no}`);
    if (row.purpose) commentParts.push(String(row.purpose).slice(0, 240));
    const comment = (row.comment != null && String(row.comment).trim())
      ? String(row.comment).trim()
      : commentParts.join(' · ');

    const payment = createPayment({
      type: row.type || (row.direction === 'debit' ? 'supplier_payment' : 'customer_income'),
      counterparty_id: row.counterparty_id || null,
      contract_id: row.contract_id || null,
      document_id: null,
      amount,
      date: row.date,
      comment,
      external_ref: row.external_ref || null,
      import_batch_id: batchId,
    }, userId, branchId, userRole);

    created.push(payment);
  }

  return {
    import_batch_id: batchId,
    created_count: created.length,
    skipped_count: skipped.length,
    created,
    skipped,
  };
}
