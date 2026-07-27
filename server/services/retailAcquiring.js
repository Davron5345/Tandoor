import { DEFAULT_BRANCH_ID } from '../branches.js';
import {
  createCounterparty,
  createCounterpartyContract,
  createCounterpartyFirm,
  getCounterparties,
  getCounterpartyContracts,
  getCounterpartyFirms,
  updateCounterpartyFirm,
  DEFAULT_CONTRACT_ID,
} from './counterparties.js';

/** Каналы эквайринга / инкассо под одним клиентом «Клиент» (как фирмы у поставщика). */
export const RETAIL_CHANNELS = [
  {
    id: 'click',
    label: 'Click',
    keywords: ['click', 'клик'],
    patterns: [/\bCLICK\b/i, /CLICK\s*AJ/i],
  },
  {
    id: 'payme',
    label: 'Payme',
    keywords: ['payme', 'пейм'],
    patterns: [/\bPAYME\b/i],
  },
  {
    id: 'inkasso',
    label: 'Инкассо',
    keywords: ['инкассо', 'inkasso', 'инк'],
    patterns: [
      /инкассир/i,
      /инкассац/i,
      /инкассов/i,
      /денежн\w*\s+выручк/i,
      /00650\s*инк/i,
      /\bинк\b/i,
    ],
  },
  {
    id: 'humo',
    label: 'Humo',
    keywords: ['humo', 'хумо'],
    patterns: [/\bHUMO\b/i, /хумо/i],
  },
  {
    id: 'uzcard',
    label: 'Uzcard',
    keywords: ['uzcard', 'узкард'],
    patterns: [/\bUZCARD\b/i, /UZ.?CARD/i, /узкард/i],
  },
  {
    id: 'uzum',
    label: 'Uzum Card',
    keywords: ['uzum', 'узум'],
    patterns: [/\bUZUM\b/i, /узум/i],
  },
  {
    id: 'terminal',
    label: 'Терминал',
    keywords: ['терминал', 'terminal', 'pos', 'union', 'smartvista'],
    patterns: [/UNIONPAY/i, /SMARTVISTA/i, /ТЕР:/i, /ТЕРМИНАЛ/i],
  },
];

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/["'«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectRetailChannel(name, purpose) {
  const text = `${name || ''} ${purpose || ''}`;
  for (const ch of RETAIL_CHANNELS) {
    if (ch.patterns.some((re) => re.test(text))) return ch;
  }
  return null;
}

export function matchRetailContract(contracts, channel) {
  if (!channel || !contracts?.length) return null;
  const real = contracts.filter((c) => c.id !== DEFAULT_CONTRACT_ID && !c.virtual);
  for (const kw of channel.keywords) {
    const hit = real.find((c) => normalizeName(c.number).includes(kw)
      || normalizeName(c.title).includes(kw));
    if (hit) return hit;
  }
  return null;
}

export function matchRetailFirm(firms, channel) {
  if (!channel || !firms?.length) return null;
  const label = normalizeName(channel.label);
  const exact = firms.find((f) => normalizeName(f.name) === label);
  if (exact) return exact;
  for (const kw of channel.keywords) {
    const hit = firms.find((f) => normalizeName(f.name).includes(kw));
    if (hit) return hit;
  }
  return null;
}

function findRetailClient(counterparties) {
  const clients = (counterparties || []).filter((c) => c.type === 'client');
  return clients.find((c) => /^клиент$/i.test(String(c.name || '').trim()))
    || clients.find((c) => normalizeName(c.name) === 'клиент')
    || null;
}

/**
 * Один клиент «Клиент» + фирмы/договоры по каналам (Click, Payme, Терминал, …).
 */
export function ensureRetailClientSetup(branchId = DEFAULT_BRANCH_ID) {
  const list = getCounterparties('client', branchId);
  let client = findRetailClient(list);
  if (!client) {
    client = createCounterparty({
      name: 'Клиент',
      type: 'client',
      notes: 'Эквайринг и инкассо (Click / Payme / Терминал / …)',
    }, branchId);
  }

  let contracts = getCounterpartyContracts(client.id, branchId)
    .filter((c) => c.id !== DEFAULT_CONTRACT_ID && !c.virtual);
  let firms = getCounterpartyFirms(client.id, branchId);

  for (const ch of RETAIL_CHANNELS) {
    let contract = matchRetailContract(contracts, ch);
    if (!contract) {
      contract = createCounterpartyContract(client.id, {
        number: ch.label,
        title: ch.label,
        is_default: false,
      }, branchId);
      contracts = [...contracts, contract];
    }

    let firm = matchRetailFirm(firms, ch);
    if (!firm) {
      firm = createCounterpartyFirm(client.id, {
        name: ch.label,
        inn: '',
        contract_id: contract.id,
        is_default: false,
      }, branchId);
      firms = [...firms, firm];
    } else if (!firm.contract_id) {
      try {
        firm = updateCounterpartyFirm(client.id, firm.id, { contract_id: contract.id }, branchId)
          || firm;
      } catch {
        /* ignore */
      }
      firms = getCounterpartyFirms(client.id, branchId);
    }
  }

  return {
    client,
    contracts: getCounterpartyContracts(client.id, branchId)
      .filter((c) => c.id !== DEFAULT_CONTRACT_ID && !c.virtual),
    firms: getCounterpartyFirms(client.id, branchId),
  };
}
