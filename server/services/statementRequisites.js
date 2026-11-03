import db from '../db.js';
import { DEFAULT_BRANCH_ID } from '../branches.js';
import {
  parseAccReferenceReportBuffer,
  parseAccReferenceReportText,
  isBankServiceFee,
  pickCounterpartyInnFromName,
  detectAcquiringChannelLabel,
} from './bankStatementImport.js';
import {
  getCounterparties,
  createCounterparty,
  createCounterpartyFirm,
  updateCounterpartyFirm,
  createCounterpartyContract,
  getCounterpartyFirms,
  getCounterpartyContracts,
  findCounterpartyFirmByInn,
} from './counterparties.js';

const { queryOne, run } = db;

const OWN_NAME_RE = /MAHALLA|МАХАЛЛ/i;

function normalizeInn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 9 ? digits : null;
}

function normalizeAccount(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 16 ? digits : null;
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/["'«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanPartyName(name, inn = null) {
  let n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  if (inn) n = n.replace(new RegExp(`\\b${inn}\\b`, 'g'), ' ');
  n = n.replace(/\b\d{9}\b/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}

function parseContractDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!dmy) return null;
  let y = Number(dmy[3]);
  if (y < 100) y += 2000;
  return `${y}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
}

/** Номер и дата договора из назначения платежа. */
export function extractContractsFromPurpose(purpose) {
  const text = String(purpose || '');
  if (!text) return [];
  const found = [];
  const seen = new Set();
  // «договор», «договору», «дог.», «дог №…», опционально «от дд.мм.гггг»
  const re = /дог(?:овор[а-яёa-z]*)?\.?\s*(?:№|#|N[oоº.]?\s*)?\s*([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9./\\-]{0,48}?)(?=\s|$|[,;)]|(?:\s*(?:от|ОТ)\b))(?:\s*(?:от|ОТ)\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}))?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    let number = String(m[1] || '').replace(/[.,;:]+$/g, '').trim();
    if (!number || number.length < 2) continue;
    if (/^(от|по|за|на|и|с)$/i.test(number)) continue;
    const date = parseContractDate(m[2] || '');
    const key = `${normalizeName(number)}|${date || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ number, date });
  }
  return found;
}

function partyKey(inn, name) {
  if (inn) return `inn:${inn}`;
  const n = normalizeName(name);
  return n ? `name:${n}` : null;
}

function preferName(current, next) {
  const a = String(current || '').trim();
  const b = String(next || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (b.length > a.length + 3) return b;
  return a;
}

function isOwnParty(name, inn, ownInns) {
  if (inn && ownInns.has(inn)) return true;
  return OWN_NAME_RE.test(name || '');
}

function pickRequisiteInn(raw, ownInns) {
  const fromName = pickCounterpartyInnFromName(raw.name, ownInns);
  if (fromName) return fromName;
  const col = normalizeInn(raw.innCol);
  if (col && !ownInns.has(col)) return col;
  return null;
}

function buildRequisitesPreview(parsed, branchId = DEFAULT_BRANCH_ID) {
  const rawRows = parsed.rows || [];
  const meta = parsed.meta || {};
  const ownInns = new Set();
  for (const row of rawRows) {
    if (isBankServiceFee(row) || OWN_NAME_RE.test(row.name || '')) {
      const inn = pickCounterpartyInnFromName(row.name, new Set()) || normalizeInn(row.innCol);
      if (inn) ownInns.add(inn);
    }
  }
  ownInns.add('311330873');

  const map = new Map();

  for (const raw of rawRows) {
    if (isBankServiceFee(raw)) continue;
    // Эквайринг (Click/Payme/…) — уже в справочнике «Клиент», в список не тащим
    if (detectAcquiringChannelLabel(raw.name, raw.purpose)) continue;
    const inn = pickRequisiteInn(raw, ownInns);
    const name = cleanPartyName(raw.name, inn);
    if (!name && !inn) continue;
    if (isOwnParty(name, inn, ownInns)) continue;

    const key = partyKey(inn, name);
    if (!key) continue;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        name,
        inn,
        type: 'supplier',
        debit_hits: 0,
        credit_hits: 0,
        accounts: [],
        contracts: [],
        mentions: 0,
        selected: true,
      };
      map.set(key, entry);
    } else {
      entry.name = preferName(entry.name, name);
      if (!entry.inn && inn) entry.inn = inn;
    }

    entry.mentions += 1;
    if (raw.debit > 0) entry.debit_hits += 1;
    if (raw.credit > 0) entry.credit_hits += 1;

    const account = normalizeAccount(raw.account);
    if (account && !entry.accounts.includes(account)) entry.accounts.push(account);

    for (const c of extractContractsFromPurpose(raw.purpose)) {
      const ck = `${normalizeName(c.number)}|${c.date || ''}`;
      if (!entry.contracts.some((x) => `${normalizeName(x.number)}|${x.date || ''}` === ck)) {
        entry.contracts.push(c);
      }
    }
  }

  const existing = getCounterparties(null, branchId);
  const items = [...map.values()].map((entry) => {
    entry.type = entry.credit_hits > entry.debit_hits ? 'client' : 'supplier';

    let match = null;
    let matchReason = '';
    if (entry.inn) {
      const firm = findCounterpartyFirmByInn(entry.inn, branchId);
      if (firm) {
        match = {
          counterparty_id: firm.counterparty_id,
          counterparty_name: firm.counterparty_name,
          firm_id: firm.id,
          firm_name: firm.name,
          firm_bank_account: firm.bank_account || null,
        };
        matchReason = `в справочнике: ${firm.counterparty_name} / ${firm.name}`;
      }
    }
    if (!match) {
      const n = normalizeName(entry.name);
      const hit = existing.find((c) => {
        const cn = normalizeName(c.name);
        if (!cn || !n || Math.min(cn.length, n.length) < 5) return false;
        return cn === n || cn.startsWith(n) || n.startsWith(cn);
      });
      if (hit) {
        match = {
          counterparty_id: hit.id,
          counterparty_name: hit.name,
          firm_id: null,
          firm_name: null,
          firm_bank_account: null,
        };
        matchReason = `похоже на «${hit.name}»`;
      }
    }

    const newAccounts = entry.accounts.filter((a) => {
      if (!match?.firm_bank_account) return true;
      return normalizeAccount(match.firm_bank_account) !== a;
    });

    return {
      key: entry.key,
      name: entry.name,
      inn: entry.inn,
      type: entry.type,
      accounts: entry.accounts,
      contracts: entry.contracts,
      mentions: entry.mentions,
      selected: !match,
      in_directory: Boolean(match?.counterparty_id),
      match,
      match_reason: matchReason || 'новый',
      new_accounts: match ? newAccounts : entry.accounts,
    };
  });

  items.sort((a, b) => {
    if (a.in_directory !== b.in_directory) return a.in_directory ? 1 : -1;
    return String(a.name).localeCompare(String(b.name), 'ru');
  });

  return {
    format: parsed.format || 'AccReferenceReport',
    bank: 'Ipak Yuli',
    own_account: meta?.own_account || null,
    own_name: meta?.own_name || null,
    total_ops: rawRows.length,
    total: items.length,
    new_count: items.filter((i) => !i.in_directory).length,
    items,
  };
}

/** Excel AccReferenceReport → уникальные реквизиты. */
export function previewStatementRequisites(buffer, branchId = DEFAULT_BRANCH_ID) {
  return buildRequisitesPreview(parseAccReferenceReportBuffer(buffer), branchId);
}

/** Текст Client Bank (копипаст) → уникальные реквизиты. */
export function previewStatementRequisitesText(text, branchId = DEFAULT_BRANCH_ID) {
  return buildRequisitesPreview(parseAccReferenceReportText(text), branchId);
}

function existingContractNumbers(counterpartyId, branchId) {
  const list = getCounterpartyContracts(counterpartyId, branchId);
  return new Set(
    list
      .filter((c) => c.id !== '__default__' && !c.virtual)
      .map((c) => normalizeName(c.number)),
  );
}

/**
 * Создать/дополнить справочник по выбранным строкам превью.
 */
export function applyStatementRequisites(items, branchId = DEFAULT_BRANCH_ID) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Нет выбранных контрагентов');
  }

  const created = [];
  const updated = [];
  const skipped = [];

  for (const raw of items) {
    if (raw?.selected === false) {
      skipped.push({ key: raw.key, reason: 'пропущен' });
      continue;
    }
    const name = cleanPartyName(raw.name, raw.inn);
    const inn = normalizeInn(raw.inn);
    if (!name) {
      skipped.push({ key: raw.key, reason: 'нет названия' });
      continue;
    }
    const type = raw.type === 'client' ? 'client' : 'supplier';
    const accounts = [...new Set((raw.accounts || []).map(normalizeAccount).filter(Boolean))];
    const contracts = Array.isArray(raw.contracts) ? raw.contracts : [];

    let counterpartyId = raw.match?.counterparty_id || null;
    let firmId = raw.match?.firm_id || null;

    if (!counterpartyId && inn) {
      const firm = findCounterpartyFirmByInn(inn, branchId);
      if (firm) {
        counterpartyId = firm.counterparty_id;
        firmId = firm.id;
      }
    }

    if (!counterpartyId) {
      const cp = createCounterparty({
        name,
        type,
        inn: type === 'supplier' ? inn : null,
        notes: accounts.length > 1 ? `р/с из выписки: ${accounts.join(', ')}` : '',
      }, branchId);
      counterpartyId = cp.id;
      created.push({ key: raw.key, counterparty_id: cp.id, name: cp.name });
    }

    if (type === 'supplier' || (type === 'client' && inn)) {
      const firms = getCounterpartyFirms(counterpartyId, branchId);
      let firm = firmId ? firms.find((f) => f.id === firmId) : null;
      if (!firm && inn) {
        firm = firms.find((f) => normalizeInn(f.inn) === inn) || null;
      }

      const primaryAccount = accounts[0] || null;
      const extraAccounts = accounts.slice(1);
      const extraNote = extraAccounts.length
        ? `Доп. р/с: ${extraAccounts.join(', ')}`
        : '';

      if (!firm) {
        try {
          firm = createCounterpartyFirm(counterpartyId, {
            name,
            inn,
            bank_account: primaryAccount,
            is_default: firms.length === 0,
          }, branchId);
          if (extraNote) {
            const cp = queryOne('SELECT notes FROM counterparties WHERE id = ?', [counterpartyId]);
            const notes = [cp?.notes, extraNote].filter(Boolean).join('\n');
            if (notes) {
              run('UPDATE counterparties SET notes = ?, updated_at = datetime(\'now\') WHERE id = ?', [
                notes, counterpartyId,
              ]);
            }
          }
          updated.push({ key: raw.key, action: 'firm_created', firm_id: firm.id });
        } catch (e) {
          // ИНН уже у другой карточки — только пометка
          skipped.push({ key: raw.key, reason: e.message });
          continue;
        }
      } else {
        const patch = {};
        if (primaryAccount && normalizeAccount(firm.bank_account) !== primaryAccount) {
          if (!firm.bank_account) patch.bank_account = primaryAccount;
          else if (normalizeAccount(firm.bank_account) !== primaryAccount) {
            const cp = queryOne('SELECT notes FROM counterparties WHERE id = ?', [counterpartyId]);
            const noteLine = `р/с из выписки: ${[firm.bank_account, ...accounts]
              .map(normalizeAccount)
              .filter(Boolean)
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .join(', ')}`;
            const notes = [cp?.notes, noteLine].filter(Boolean).join('\n');
            run('UPDATE counterparties SET notes = ?, updated_at = datetime(\'now\') WHERE id = ?', [
              notes, counterpartyId,
            ]);
          }
        }
        if (inn && !firm.inn) patch.inn = inn;
        if (Object.keys(patch).length) {
          updateCounterpartyFirm(counterpartyId, firm.id, { ...firm, ...patch }, branchId);
          updated.push({ key: raw.key, action: 'firm_updated', firm_id: firm.id });
        }
        firmId = firm.id;
      }
      if (firm) firmId = firm.id;
    }

    const known = existingContractNumbers(counterpartyId, branchId);
    for (const c of contracts) {
      const num = String(c.number || '').trim();
      if (!num) continue;
      if (known.has(normalizeName(num))) continue;
      try {
        createCounterpartyContract(counterpartyId, {
          number: num,
          date: c.date || null,
          firm_id: firmId || null,
          direction: type === 'client' ? 'sale' : 'purchase',
        }, branchId);
        known.add(normalizeName(num));
        updated.push({ key: raw.key, action: 'contract_created', number: num });
      } catch (e) {
        skipped.push({ key: raw.key, reason: e.message, contract: num });
      }
    }
  }

  return {
    created_count: created.length,
    updated_count: updated.length,
    skipped_count: skipped.length,
    created,
    updated,
    skipped,
  };
}
