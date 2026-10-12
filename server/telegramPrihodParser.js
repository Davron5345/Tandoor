// Разбор сообщений зав. склада из Telegram вида:
//   Жалилдан:
//   Сон-45,8кг
//   К,ўзи думбасиз -2та-26,2кг

const UNIT_ALIASES = {
  килограмм: 'кг', кило: 'кг', кг: 'кг', kg: 'кг',
  грамм: 'г', гр: 'г', gr: 'г', г: 'г', g: 'г',
  литр: 'л', lt: 'л', л: 'л', l: 'л',
  штука: 'шт', штуки: 'шт', штук: 'шт', шт: 'шт', дона: 'шт', dona: 'шт', pcs: 'шт', pc: 'шт', та: 'шт', ta: 'шт',
};
const WEIGHT_UNITS = new Set(['кг', 'г', 'л']);
const UNIT_PATTERN = 'килограмм|кило|кг|kg|грамм|гр|gr|г|g|литр|lt|л|l|штука|штуки|штук|шт|дона|dona|pcs|pc|та|ta';
const TOKEN_AT_END_RE = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})?\\.?$`, 'iu');
const TRAILING_SEPARATORS_RE = /[\s\-–—=:;,*]+$/u;
const ABLATIVE_RE = /(дан|тан|dan|tan)$/iu;

const COMMA_LETTERS = {
  к: 'қ', К: 'Қ', k: 'қ', K: 'Қ',
  г: 'ғ', Г: 'Ғ',
  у: 'ў', У: 'Ў',
  х: 'ҳ', Х: 'Ҳ',
};

/** «К,ўзи» → «Қўзи»: узбекские буквы, набранные через запятую. */
export function fixUzbekCommaLetters(text) {
  return String(text || '').replace(/([кКkKгГуУхХ]),(?=\p{Ll})/gu, (_, ch) => COMMA_LETTERS[ch] || ch);
}

function parseNumber(raw) {
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizeUnit(raw) {
  if (!raw) return null;
  return UNIT_ALIASES[raw.toLowerCase()] || null;
}

function roundQty(n) {
  return Math.round(n * 1000) / 1000;
}

export function parseItemLine(rawLine) {
  const line = fixUzbekCommaLetters(String(rawLine || '').trim());
  let rest = line;
  const tokens = [];
  while (tokens.length < 4) {
    rest = rest.replace(TRAILING_SEPARATORS_RE, '');
    const m = rest.match(TOKEN_AT_END_RE);
    if (!m) break;
    const value = parseNumber(m[1]);
    if (value == null) break;
    tokens.unshift({ value, unit: normalizeUnit(m[2]), text: m[0].trim(), index: m.index });
    rest = rest.slice(0, m.index);
  }
  if (!tokens.length) return null;

  // «Кола 1,5л - 12шт»: вес перед штуками — часть названия (фасовка)
  const last = tokens[tokens.length - 1];
  let used = tokens;
  if (last.unit === 'шт' && tokens.length > 1) {
    const firstPiecesOrBare = tokens.findIndex((t) => !WEIGHT_UNITS.has(t.unit));
    if (firstPiecesOrBare > 0) {
      rest = `${rest} ${tokens.slice(0, firstPiecesOrBare).map((t) => t.text).join(' ')}`;
      used = tokens.slice(firstPiecesOrBare);
    }
  }

  const name = rest.replace(TRAILING_SEPARATORS_RE, '').replace(/\s+/g, ' ').trim();
  if (!name || !/\p{L}/u.test(name)) return null;

  const weight = [...used].reverse().find((t) => WEIGHT_UNITS.has(t.unit));
  const pieces = [...used].reverse().find((t) => t.unit === 'шт');
  const bare = [...used].reverse().find((t) => !t.unit);

  let quantity;
  let unit;
  if (weight) {
    quantity = weight.unit === 'г' ? roundQty(weight.value / 1000) : weight.value;
    unit = weight.unit === 'г' ? 'кг' : weight.unit;
  } else if (pieces) {
    quantity = pieces.value;
    unit = 'шт';
  } else {
    quantity = bare.value;
    unit = null;
  }
  if (!(quantity > 0)) return null;

  return {
    raw: String(rawLine || '').trim(),
    name,
    quantity: roundQty(quantity),
    unit,
    pieces: weight && pieces ? pieces.value : null,
  };
}

function parseSupplierHeader(rawLine) {
  const line = fixUzbekCommaLetters(String(rawLine || '').trim());
  if (!line || /\d/.test(line)) return null;
  const hasColon = /:\s*$/.test(line);
  let name = line.replace(/:\s*$/, '').trim().replace(/^от\s+/iu, '');
  if (!name) return null;
  const hasAblative = ABLATIVE_RE.test(name);
  if (!hasColon && !hasAblative) return null;
  if (name.split(/\s+/).length > 4) return null;
  const stem = hasAblative && name.length - 3 >= 2 ? name.replace(ABLATIVE_RE, '').trim() : name;
  return { raw: line.replace(/:\s*$/, '').trim(), name: stem };
}

const DATE_IN_LINE_RE = /(?:^|[\s(])(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?:\s*(?:г\.?|й?ил|yil))?(?=$|[\s:),-])/iu;
const DATE_WORDS = new Set([
  'сана', 'дата', 'sana', 'число', 'приход', 'prixod', 'prihod', 'kirim', 'кирим', 'кун', 'куни', 'kun', 'kuni', 'от', 'за',
]);

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Дата, написанная в сообщении: «06.10», «06.10.2026», «Сана: 6.10», «06.10 Жалилдан:».
 * Без года — год даты сообщения (если получилось сильно «в будущем» — прошлый год).
 * @returns {{ date: string, rest: string } | null}
 */
export function parseDateLine(rawLine, referenceDate = null) {
  const line = String(rawLine || '').trim();
  const m = line.match(DATE_IN_LINE_RE);
  if (!m) return null;
  const before = line.slice(0, m.index).replace(/[\s:;,.\-–—]+/gu, ' ').trim();
  const after = line.slice(m.index + m[0].length).trim();
  const words = before.split(' ').filter((w) => w && !DATE_WORDS.has(w.toLowerCase()));
  const rest = [...words, after.replace(/^[\s:;,.\-–—]+/u, '')].filter(Boolean).join(' ').trim();
  const restWords = rest.replace(/[:\s]+$/u, '').split(/\s+/).filter((w) => w && !DATE_WORDS.has(w.toLowerCase()));
  if (/\d/.test(rest)) return null;
  if (restWords.length && !parseSupplierHeader(rest)) return null;
  const date = resolveDate(m, referenceDate);
  return date ? { date, rest: restWords.length ? rest : '' } : null;
}

function resolveDate(m, referenceDate) {
  const day = Number(m[1]);
  const month = Number(m[2]);
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(String(referenceDate || '')) ? String(referenceDate) : null;
  const refYear = ref ? Number(ref.slice(0, 4)) : new Date().getUTCFullYear();
  let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : refYear;
  let date = isoDate(year, month, day);
  if (!date) return null;
  if (!m[3] && ref) {
    const diffDays = (Date.parse(date) - Date.parse(ref)) / 86400000;
    if (diffDays > 31) {
      year -= 1;
      date = isoDate(year, month, day);
      if (!date) return null;
    }
  }
  return date;
}

/**
 * Текст одного сообщения → группы по поставщикам.
 * Дата в тексте («06.10») относится к поставщикам после неё; без даты — `date: null` (берётся дата сообщения).
 * @returns {{ groups: Array<{ supplier: {raw,name}|null, date: string|null, lines: object[] }>, notes: string[] }}
 */
export function parsePrihodMessage(text, { referenceDate = null } = {}) {
  const groups = [];
  const notes = [];
  let current = null;
  let currentDate = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let trimmed = rawLine.trim();
    if (!trimmed) continue;
    const dated = parseDateLine(trimmed, referenceDate);
    if (dated) {
      currentDate = dated.date;
      if (current && !current.lines.length) current.date = dated.date;
      if (!dated.rest) continue;
      trimmed = dated.rest;
    }
    const header = parseSupplierHeader(trimmed);
    if (header) {
      current = { supplier: header, date: currentDate, lines: [] };
      groups.push(current);
      continue;
    }
    const item = parseItemLine(trimmed);
    if (item) {
      if (!current) {
        current = { supplier: null, date: currentDate, lines: [] };
        groups.push(current);
      }
      current.lines.push(item);
      continue;
    }
    notes.push(trimmed);
  }

  return { groups: groups.filter((g) => g.lines.length > 0), notes };
}

const PASTE_HEADER_DESKTOP_RE = /^(.+?),\s*\[(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\]\s*$/u;
const PASTE_HEADER_INLINE_RE = /^\[(\d{1,2})\.(\d{1,2})\.(\d{2,4})[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\]\s*([^:]+?):\s*(.*)$/u;

function pasteDate(d, m, y, hh, mm) {
  const year = y.length === 2 ? `20${y}` : y;
  const pad = (v) => String(v).padStart(2, '0');
  return {
    date: `${year}-${pad(m)}-${pad(d)}`,
    time: `${pad(hh)}:${pad(mm)}`,
  };
}

/**
 * Текст, скопированный из Telegram (несколько сообщений) → отдельные сообщения.
 * Поддерживает «Нодирбек, [09.10.2026 8:39]» (desktop) и «[09.10.2026 8:39] Нодирбек: …».
 * Без заголовков — весь текст одним сообщением.
 */
export function splitPastedTelegramText(text) {
  const messages = [];
  let current = null;
  const push = () => {
    if (current && current.lines.join('').trim()) {
      messages.push({
        author: current.author,
        date: current.date,
        time: current.time,
        text: current.lines.join('\n').trim(),
      });
    }
  };

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    let m = line.match(PASTE_HEADER_DESKTOP_RE);
    if (m) {
      push();
      current = { author: m[1].trim(), ...pasteDate(m[2], m[3], m[4], m[5], m[6]), lines: [] };
      continue;
    }
    m = line.match(PASTE_HEADER_INLINE_RE);
    if (m) {
      push();
      current = { author: m[6].trim(), ...pasteDate(m[1], m[2], m[3], m[4], m[5]), lines: m[7] ? [m[7]] : [] };
      continue;
    }
    if (!current) current = { author: null, date: null, time: null, lines: [] };
    current.lines.push(rawLine);
  }
  push();
  return messages;
}

const LATIN_TO_CYR = [
  ["o'", 'у'], ["g'", 'г'], ['sh', 'ш'], ['ch', 'ч'], ['yo', 'е'], ['ye', 'е'], ['yu', 'ю'], ['ya', 'я'], ['ts', 'ц'],
  ['a', 'а'], ['b', 'б'], ['c', 'с'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'],
  ['j', 'ж'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'],
  ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'х'], ['y', 'й'], ['z', 'з'],
];

function latinToCyrillic(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const pair = LATIN_TO_CYR.find(([lat]) => text.startsWith(lat, i));
    if (pair) {
      out += pair[1];
      i += pair[0].length;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/**
 * Ключ для сравнения названий: латиница и кириллица (рус./узб.) сводятся к одному написанию —
 * «Qo'zi» = «Қўзи» = «Кузи», «Jigari» ≈ «Жигари», «Murod» ≈ «Мурод».
 */
export function matchKey(text) {
  let s = fixUzbekCommaLetters(String(text || '')).toLowerCase()
    .replace(/[ʻʼ‘’`]/g, "'");
  if (/[a-z]/.test(s)) s = latinToCyrillic(s);
  return s
    .replace(/ё/g, 'е')
    .replace(/қ/g, 'к')
    .replace(/ғ/g, 'г')
    .replace(/ў/g, 'у')
    .replace(/ҳ/g, 'х')
    .replace(/[йы]/g, 'и')
    .replace(/э/g, 'е')
    .replace(/щ/g, 'ш')
    .replace(/ц/g, 'с')
    .replace(/[ъь]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(\p{L})\1+/gu, '$1')
    .trim();
}

export function matchTokens(text) {
  const key = matchKey(text);
  return key ? key.split(' ') : [];
}

function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Похожесть двух слов 0..1: равны, окончание (жигар/жигари, жалил/жалилов), опечатка (мурот/мурод). */
export function tokenSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const maxSuffix = short.length === 3 ? 2 : 3;
  if (short.length >= 3 && long.startsWith(short) && long.length - short.length <= maxSuffix) return 0.85;
  if (/\d/.test(short) || /\d/.test(long)) return 0;
  if (short.length >= 4 && editDistance(short, long, 1) <= 1) return 0.8;
  if (short.length >= 7 && editDistance(short, long, 2) <= 2) return 0.7;
  if (short.length >= 4 && long.length - short.length <= 4 && editDistance(short, long.slice(0, short.length), 1) <= 1) return 0.65;
  return 0;
}

/**
 * Насколько название-кандидат подходит под слова из сообщения (0..95).
 * Все слова сообщения найдены → ≥ 50; полное совпадение → 95.
 */
export function scoreTokens(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const used = new Set();
  let sum = 0;
  let matched = 0;
  for (const q of queryTokens) {
    let best = 0;
    let bestIdx = -1;
    candidateTokens.forEach((c, idx) => {
      const s = tokenSimilarity(q, c);
      if (s > best || (s === best && s > 0 && used.has(bestIdx) && !used.has(idx))) {
        best = s;
        bestIdx = idx;
      }
    });
    if (best > 0) {
      matched += 1;
      used.add(bestIdx);
    }
    sum += best;
  }
  const quality = sum / queryTokens.length;
  if (matched < queryTokens.length) return Math.round(40 * quality);
  const coverage = used.size / candidateTokens.length;
  return Math.round(50 + 30 * quality + 15 * coverage);
}
