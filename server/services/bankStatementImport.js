import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import { createPayment, deletePaymentsByDate } from './payments.js';
import {
  createCounterparty,
  createCounterpartyFirm,
  updateCounterpartyFirm,
  getCounterparties,
  getCounterpartyContracts,
  findCounterpartyFirmByInn,
  DEFAULT_CONTRACT_ID,
} from './counterparties.js';

const { queryOne, queryAll, transaction } = db;

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

function normalizeAccount(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function cleanFirmName(name, inn = null) {
  let n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  if (inn) {
    n = n.replace(new RegExp(`\\b${inn}\\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
  }
  n = n.replace(/\b\d{9}\b/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}

/** Сравнение названия фирмы из выписки и справочника. */
function firmNamesMatch(statementName, firmName) {
  const a = normalizeName(cleanFirmName(statementName)).replace(/\d{9}/g, '').trim();
  const b = normalizeName(cleanFirmName(firmName)).replace(/\d{9}/g, '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 5;
  return false;
}

/**
 * Сверка найденной фирмы с выпиской: ИНН уже совпал.
 * — название + р/с совпали → полное совпадение
 * — название совпало, р/с другой/пустой → новый счёт
 * — название отличается → предупреждение, но привязка по ИНН
 */
function reconcileFirmWithStatement(firm, { inn, statementName, statementAccount }) {
  const nameOk = firmNamesMatch(statementName, firm.name);
  const stmtAcc = normalizeAccount(statementAccount);
  const firmAcc = normalizeAccount(firm.bank_account);
  let isNewAccount = false;
  let matchReason = '';

  if (nameOk && stmtAcc && firmAcc && firmAcc !== stmtAcc) {
    isNewAccount = true;
    matchReason = `новый р/с ${stmtAcc} у «${firm.name}» (ИНН ${inn}, был ${firmAcc}) → ${firm.counterparty_name}`;
  } else if (nameOk && stmtAcc && !firmAcc) {
    isNewAccount = true;
    matchReason = `новый р/с ${stmtAcc} у «${firm.name}» (ИНН ${inn}) → ${firm.counterparty_name}`;
  } else if (nameOk && stmtAcc && firmAcc === stmtAcc) {
    matchReason = `совпало: «${firm.name}» ИНН ${inn} р/с ${stmtAcc} → ${firm.counterparty_name}`;
  } else if (nameOk) {
    matchReason = `фирма «${firm.name}» (ИНН ${inn}) → ${firm.counterparty_name}`;
  } else {
    matchReason = `ИНН ${inn} → «${firm.name}» / ${firm.counterparty_name} (название в выписке отличается)`;
  }

  return { isNewAccount, nameOk, matchReason };
}

function suggestedCounterpartyType(paymentType) {
  if (paymentType === 'supplier_payment' || paymentType === 'other_income') return 'supplier';
  if (paymentType === 'customer_income' || paymentType === 'other_expense') return 'client';
  return 'supplier';
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
    replaceDateSet, identicalDateSet,
  } = ctx;
  const direction = raw.debit > 0 ? 'debit' : 'credit';
  const amount = direction === 'debit' ? raw.debit : raw.credit;
  const channel = direction === 'credit' ? detectAcquiringChannel(raw.name, raw.purpose) : null;
  const counterpartyInn = pickCounterpartyInn(raw.name, raw.purpose, raw.innCol, ownInns);
  const externalRef = makeExternalRef(raw);
  const refHit = existingRefs instanceof Map
    ? existingRefs.get(externalRef)
    : (existingRefs?.has?.(externalRef) ? { id: true } : null);
  const willReplaceDate = replaceDateSet?.has?.(raw.date);
  const identicalDate = identicalDateSet?.has?.(raw.date);
  // Same calendar day will be replaced — do not treat as «already imported»
  const alreadyImported = Boolean(refHit) && !willReplaceDate;
  const suggestedName = cleanFirmName(raw.name, counterpartyInn);

  let type = direction === 'debit' ? 'supplier_payment' : 'customer_income';
  let counterparty = null;
  let contract = null;
  let selected = true;
  let matchReason = '';
  let channelId = null;
  let channelLabel = null;
  let isNewFirm = false;
  let isNewAccount = false;
  let firmMatch = null;

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
    firmMatch = counterpartyInn ? findCounterpartyFirmByInn(counterpartyInn, ctx.branchId) : null;
    if (firmMatch) {
      counterparty = {
        id: firmMatch.counterparty_id,
        name: firmMatch.counterparty_name,
        type: firmMatch.counterparty_type,
      };
      type = 'supplier_payment';
      const recon = reconcileFirmWithStatement(firmMatch, {
        inn: counterpartyInn,
        statementName: suggestedName || raw.name,
        statementAccount: raw.account,
      });
      isNewAccount = recon.isNewAccount;
      matchReason = recon.matchReason;
    } else {
      counterparty = matchByInn(counterparties, counterpartyInn)
        || matchByName(counterparties, raw.name, 'supplier');
      if (counterparty?.type === 'client') {
        type = 'other_expense';
        matchReason = counterpartyInn
          ? `возврат/расход клиенту по ИНН ${counterpartyInn}`
          : 'расход клиенту по имени';
      } else {
        type = 'supplier_payment';
        if (counterparty) {
          matchReason = counterpartyInn
            ? `поставщик по ИНН ${counterpartyInn}`
            : 'поставщик по имени';
        } else if (counterpartyInn || suggestedName) {
          isNewFirm = true;
          matchReason = counterpartyInn
            ? `новая фирма: ${suggestedName || raw.name} (ИНН ${counterpartyInn}${raw.account ? `, р/с ${normalizeAccount(raw.account) || raw.account}` : ''}) — создастся при сохранении`
            : `новая фирма: ${suggestedName} — создастся при сохранении`;
        } else {
          matchReason = 'поставщик не распознан';
        }
      }
    }
  } else {
    firmMatch = counterpartyInn ? findCounterpartyFirmByInn(counterpartyInn, ctx.branchId) : null;
    if (firmMatch) {
      counterparty = {
        id: firmMatch.counterparty_id,
        name: firmMatch.counterparty_name,
        type: firmMatch.counterparty_type,
      };
      const recon = reconcileFirmWithStatement(firmMatch, {
        inn: counterpartyInn,
        statementName: suggestedName || raw.name,
        statementAccount: raw.account,
      });
      isNewAccount = recon.isNewAccount;
      matchReason = recon.matchReason;
    } else {
      counterparty = matchByInn(counterparties, counterpartyInn)
        || matchByName(counterparties, raw.name, 'client');
    }
    if (!firmMatch && counterparty?.type === 'supplier') {
      type = 'other_income';
      matchReason = counterpartyInn
        ? `возврат от поставщика по ИНН ${counterpartyInn}`
        : 'приход от поставщика по имени';
    } else if (!firmMatch) {
      type = 'customer_income';
      if (counterparty) {
        matchReason = counterpartyInn
          ? `клиент по ИНН ${counterpartyInn}`
          : 'клиент по имени';
      } else if (counterpartyInn || suggestedName) {
        isNewFirm = true;
        matchReason = counterpartyInn
          ? `новая фирма: ${suggestedName || raw.name} (ИНН ${counterpartyInn}${raw.account ? `, р/с ${normalizeAccount(raw.account) || raw.account}` : ''}) — создастся при сохранении`
          : `новая фирма: ${suggestedName} — создастся при сохранении`;
      } else {
        matchReason = 'контрагент не распознан';
      }
    } else {
      type = counterparty?.type === 'supplier' ? 'other_income' : 'customer_income';
    }
  }

  if (identicalDate) {
    selected = false;
    matchReason = matchReason
      ? `дата без изменений (${matchReason})`
      : 'дата без изменений — выписка уже загружена';
  } else if (willReplaceDate) {
    selected = true;
    matchReason = matchReason
      ? `заменит выписку за дату (${matchReason})`
      : 'заменит выписку за дату';
  } else if (alreadyImported) {
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
    suggested_name: suggestedName || null,
    suggested_type: suggestedCounterpartyType(type),
    is_new_firm: isNewFirm && !alreadyImported && !identicalDate,
    is_new_account: isNewAccount && !alreadyImported && !identicalDate && !isNewFirm,
    type,
    counterparty_id: counterparty?.id || null,
    counterparty_name: counterparty?.name || null,
    firm_id: firmMatch?.id || null,
    firm_name: firmMatch?.name || null,
    firm_bank_account: firmMatch?.bank_account || null,
    contract_id: contract?.id || null,
    contract_number: contract?.number || null,
    channel: channelId,
    channel_label: channelLabel,
    selected,
    already_imported: alreadyImported || identicalDate,
    replaces_date: Boolean(willReplaceDate),
    match_reason: matchReason,
  };
}

function collectNewFirms(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.is_new_firm || r.already_imported) continue;
    const key = r.inn || normalizeName(r.suggested_name || r.name);
    if (!key || map.has(key)) continue;
    map.set(key, {
      inn: r.inn || null,
      name: r.suggested_name || cleanFirmName(r.name, r.inn) || r.name,
      account: normalizeAccount(r.account) || r.account || null,
      type: r.suggested_type || suggestedCounterpartyType(r.type),
    });
  }
  return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
}

function collectNewAccounts(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.is_new_account || r.already_imported || !r.firm_id) continue;
    const acc = normalizeAccount(r.account) || r.account;
    if (!acc) continue;
    const key = `${r.firm_id}:${acc}`;
    if (map.has(key)) continue;
    map.set(key, {
      firm_id: r.firm_id,
      firm_name: r.firm_name || r.suggested_name || r.name,
      counterparty_id: r.counterparty_id,
      counterparty_name: r.counterparty_name,
      inn: r.inn || null,
      account: acc,
      previous_account: normalizeAccount(r.firm_bank_account) || r.firm_bank_account || null,
    });
  }
  return [...map.values()].sort((a, b) => String(a.firm_name).localeCompare(String(b.firm_name), 'ru'));
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
  const existingDates = buildExistingDateDiffs(rawRows, branchId);
  const replaceDateSet = new Set(
    existingDates.filter((d) => d.has_differences).map((d) => d.date),
  );
  const identicalDateSet = new Set(
    existingDates.filter((d) => d.identical).map((d) => d.date),
  );

  const existingRefs = new Map();
  for (const raw of rawRows) {
    const ref = makeExternalRef(raw);
    if (existingRefs.has(ref)) continue;
    const hit = queryOne(
      `SELECT id, date FROM payments
       WHERE external_ref = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))`,
      [ref, branchId, branchId, DEFAULT_BRANCH_ID],
    );
    if (hit) existingRefs.set(ref, hit);
  }

  const ctx = {
    counterparties,
    retailClient,
    retailContracts,
    ownInns,
    existingRefs,
    replaceDateSet,
    identicalDateSet,
    branchId,
  };
  const rows = rawRows.map((r) => classifyRow(r, ctx));

  rows.sort((a, b) => {
    const aPri = a.is_new_firm ? 0 : (a.is_new_account ? 1 : 2);
    const bPri = b.is_new_firm ? 0 : (b.is_new_account ? 1 : 2);
    if (aPri !== bPri) return aPri - bPri;
    const an = (a.counterparty_name || a.suggested_name || a.name || '')
      .localeCompare(b.counterparty_name || b.suggested_name || b.name || '', 'ru');
    if (an !== 0) return an;
    const ai = (a.inn || '').localeCompare(b.inn || '');
    if (ai !== 0) return ai;
    return String(a.date).localeCompare(String(b.date));
  });

  const newFirms = collectNewFirms(rows);
  const newAccounts = collectNewAccounts(rows);

  return {
    bank: 'Ipak Yuli',
    format: 'AccReferenceReport',
    retail_client: retailClient
      ? { id: retailClient.id, name: retailClient.name }
      : null,
    existing_dates: existingDates,
    existing_dates_count: existingDates.length,
    replace_dates: existingDates.filter((d) => d.has_differences).map((d) => d.date),
    new_firms: newFirms,
    new_firms_count: newFirms.length,
    new_accounts: newAccounts,
    new_accounts_count: newAccounts.length,
    total: rows.length,
    selected_count: rows.filter((r) => r.selected).length,
    rows,
  };
}

function buildExistingDateDiffs(rawRows, branchId) {
  const byDate = new Map();
  for (const raw of rawRows) {
    if (!raw.date) continue;
    if (!byDate.has(raw.date)) byDate.set(raw.date, []);
    byDate.get(raw.date).push(raw);
  }

  const result = [];
  for (const [date, newRaws] of byDate) {
    const existing = queryAll(
      `SELECT id, amount, type, external_ref, import_batch_id FROM payments
       WHERE date = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))`,
      [date, branchId, branchId, DEFAULT_BRANCH_ID],
    );
    if (!existing.length) continue;

    const existingByRef = new Map();
    let existingDebit = 0;
    let existingCredit = 0;
    let manualCount = 0;
    for (const p of existing) {
      const amt = Number(p.amount) || 0;
      if (p.type === 'customer_income' || p.type === 'other_income') existingCredit += amt;
      else existingDebit += amt;
      if (p.external_ref) existingByRef.set(p.external_ref, p);
      else manualCount += 1;
    }

    const newByRef = new Map();
    let newDebit = 0;
    let newCredit = 0;
    for (const raw of newRaws) {
      const ref = makeExternalRef(raw);
      newByRef.set(ref, raw);
      newDebit += Number(raw.debit) || 0;
      newCredit += Number(raw.credit) || 0;
    }

    let added = 0;
    let removed = 0;
    let changed = 0;
    for (const [ref, raw] of newByRef) {
      const old = existingByRef.get(ref);
      if (!old) {
        added += 1;
        continue;
      }
      const amt = (Number(raw.debit) || 0) > 0 ? Number(raw.debit) : Number(raw.credit);
      if (Math.abs((Number(old.amount) || 0) - amt) > 0.009) changed += 1;
    }
    for (const ref of existingByRef.keys()) {
      if (!newByRef.has(ref)) removed += 1;
    }

    const identical = added === 0
      && removed === 0
      && changed === 0
      && manualCount === 0
      && existing.length === newRaws.length;

    result.push({
      date,
      existing_count: existing.length,
      new_count: newRaws.length,
      existing_debit: existingDebit,
      existing_credit: existingCredit,
      new_debit: newDebit,
      new_credit: newCredit,
      added,
      removed,
      changed,
      manual_count: manualCount,
      identical,
      has_differences: !identical,
      has_manual: manualCount > 0,
    });
  }

  return result.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function resolveOrCreateCounterparty(row, branchId, cache, createdList) {
  if (row.counterparty_id && row.firm_id) {
    return { counterpartyId: row.counterparty_id, firmId: row.firm_id };
  }
  if (row.counterparty_id) return { counterpartyId: row.counterparty_id, firmId: null };

  const inn = normalizeInn(row.inn);
  const name = (row.suggested_name || cleanFirmName(row.name, inn) || '').trim();
  if (!row.is_new_firm && !inn && !name) return { counterpartyId: null, firmId: null };
  if (!name && !inn) return { counterpartyId: null, firmId: null };

  const cacheKey = inn || `name:${normalizeName(name)}`;
  if (cache.has(cacheKey)) {
    const hit = cache.get(cacheKey);
    return typeof hit === 'object' ? hit : { counterpartyId: hit, firmId: null };
  }

  const firmHit = inn ? findCounterpartyFirmByInn(inn, branchId) : null;
  if (firmHit) {
    const result = { counterpartyId: firmHit.counterparty_id, firmId: firmHit.id };
    cache.set(cacheKey, result);
    return result;
  }

  const existing = getCounterparties(null, branchId);
  const found = (inn && matchByInn(existing, inn))
    || (name && matchByName(existing, name, suggestedCounterpartyType(row.type)));
  if (found) {
    cache.set(cacheKey, found.id);
    return { counterpartyId: found.id, firmId: null };
  }

  const cpType = row.suggested_type || suggestedCounterpartyType(row.type);
  const created = createCounterparty({
    name: name || `ИНН ${inn}`,
    type: cpType,
    inn: '',
    notes: 'Создано из банковской выписки',
  }, branchId);
  createdList.push(created);

  let firmId = null;
  if (cpType === 'supplier' && (inn || name)) {
    try {
      const firm = createCounterpartyFirm(created.id, {
        name: name || created.name,
        inn: inn || '',
        bank_account: normalizeAccount(row.account) || row.account || '',
        is_default: true,
      }, branchId);
      firmId = firm?.id || null;
    } catch {
      /* firm may duplicate inn */
    }
  }

  const result = { counterpartyId: created.id, firmId };
  cache.set(cacheKey, result);
  if (inn) cache.set(inn, result);
  return result;
}

function applyNewBankAccount(row, counterpartyId, firmId, branchId, updatedAccounts) {
  if (!row?.is_new_account || !counterpartyId || !firmId) return;
  const account = normalizeAccount(row.account) || row.account;
  if (!account) return;
  try {
    updateCounterpartyFirm(counterpartyId, firmId, { bank_account: account }, branchId);
    updatedAccounts.push({
      firm_id: firmId,
      counterparty_id: counterpartyId,
      account,
      firm_name: row.firm_name || row.suggested_name || null,
      inn: row.inn || null,
    });
  } catch {
    /* ignore update errors — payment still created */
  }
}

/**
 * Create payments from confirmed preview rows.
 * Unmatched firms (is_new_firm) are created as counterparties on save.
 * Dates in replaceDates (or auto-detected) are cleared first — one date = one statement.
 */
export function confirmBankStatementImport(
  rows,
  userId,
  branchId = DEFAULT_BRANCH_ID,
  userRole = null,
  options = {},
) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Нет строк для импорта');
  }
  const selectedRows = rows.filter((r) => r && r.selected !== false);
  if (!selectedRows.length) {
    throw new Error('Нет строк для импорта');
  }

  const datesInSelection = [...new Set(selectedRows.map((r) => r.date).filter(Boolean))];
  let replaceDates = Array.isArray(options.replaceDates)
    ? options.replaceDates.filter(Boolean)
    : null;
  if (!replaceDates) {
    replaceDates = datesInSelection.filter((date) => {
      const hit = queryOne(
        `SELECT id FROM payments
         WHERE date = ? AND (branch_id = ? OR (branch_id IS NULL AND ? = ?))
         LIMIT 1`,
        [date, branchId, branchId, DEFAULT_BRANCH_ID],
      );
      return Boolean(hit);
    });
  }
  const replaceSet = new Set(replaceDates);

  const batchId = uuidv4();
  const created = [];
  const skipped = [];
  const createdCounterparties = [];
  const updatedAccounts = [];
  const replaced = [];
  const accountUpdateDone = new Set();
  const cpCache = new Map();

  transaction(() => {
    for (const date of replaceDates) {
      const result = deletePaymentsByDate(date, userRole, branchId);
      replaced.push(result);
    }

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
      if (row.external_ref && !replaceSet.has(row.date)) {
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

      let counterpartyId = row.counterparty_id || null;
      let firmId = row.firm_id || null;
      if (!counterpartyId && (row.is_new_firm || row.inn || row.suggested_name)) {
        const resolved = resolveOrCreateCounterparty(row, branchId, cpCache, createdCounterparties);
        counterpartyId = resolved.counterpartyId;
        firmId = firmId || resolved.firmId;
      }

      if (row.is_new_account && counterpartyId && firmId) {
        const accKey = `${firmId}:${normalizeAccount(row.account) || row.account}`;
        if (!accountUpdateDone.has(accKey)) {
          accountUpdateDone.add(accKey);
          applyNewBankAccount(row, counterpartyId, firmId, branchId, updatedAccounts);
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
        counterparty_id: counterpartyId,
        firm_id: firmId,
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
  });

  return {
    import_batch_id: batchId,
    created_count: created.length,
    skipped_count: skipped.length,
    replaced_dates: replaced,
    replaced_dates_count: replaced.length,
    deleted_count: replaced.reduce((s, r) => s + (r.deleted_count || 0), 0),
    created_counterparties_count: createdCounterparties.length,
    created_counterparties: createdCounterparties,
    updated_accounts_count: updatedAccounts.length,
    updated_accounts: updatedAccounts,
    created,
    skipped,
  };
}
