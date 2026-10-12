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

/**
 * Текст одного сообщения → группы по поставщикам.
 * @returns {{ groups: Array<{ supplier: {raw,name}|null, lines: object[] }>, notes: string[] }}
 */
export function parsePrihodMessage(text) {
  const groups = [];
  const notes = [];
  let current = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const header = parseSupplierHeader(trimmed);
    if (header) {
      current = { supplier: header, lines: [] };
      groups.push(current);
      continue;
    }
    const item = parseItemLine(trimmed);
    if (item) {
      if (!current) {
        current = { supplier: null, lines: [] };
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
  ["o'", 'у'], ["g'", 'г'], ['sh', 'ш'], ['ch', 'ч'], ['yo', 'е'], ['yu', 'ю'], ['ya', 'я'], ['ts', 'ц'],
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

/** Ключ для сравнения названий: регистр, узбекские буквы, латиница → кириллица, без знаков. */
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
    .replace(/[ъь]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
