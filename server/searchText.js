import { matchKey } from './telegramPrihodParser.js';

/**
 * Текстовый поиск по спискам (документы): регистр, латиница/кириллица (рус./узб.)
 * и неправильная раскладка клавиатуры сводятся к одному написанию через `matchKey`.
 * «Qo'zi» = «Қўзи» = «Кузи», «Vehbk» (латиница при русской раскладке) = «Мурод».
 */

const EN_TO_RU = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
  '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л',
  l: 'д', ';': 'ж', "'": 'э', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь',
  ',': 'б', '.': 'ю', '`': 'ё',
};
const RU_TO_EN = Object.fromEntries(Object.entries(EN_TO_RU).map(([en, ru]) => [ru, en]));

function swapLayout(text, map) {
  return [...String(text || '').toLowerCase()].map((ch) => map[ch] ?? ch).join('');
}

/** Варианты ключа запроса: как есть, в другой раскладке. */
export function searchQueryKeys(query) {
  const raw = String(query || '').trim().toLowerCase();
  if (!raw) return [];
  const keys = new Set();
  const add = (value) => {
    const k = matchKey(value);
    if (k) keys.add(k);
  };
  add(raw);
  add(swapLayout(raw, EN_TO_RU));
  add(swapLayout(raw, RU_TO_EN));
  return [...keys];
}

/**
 * Возвращает функцию `(text) => boolean`: содержит ли текст запрос (по нормализованному ключу
 * или как сырую подстроку — для номеров документов вроде «ПР-00012»).
 * Для пустого запроса — `null`.
 */
export function buildSearchMatcher(query) {
  const raw = String(query || '').trim().toLowerCase();
  if (!raw) return null;
  const keys = searchQueryKeys(raw);
  const words = keys.map((k) => k.split(' ').filter(Boolean));
  return (text) => {
    if (text == null || text === '') return false;
    const lower = String(text).toLowerCase();
    if (lower.includes(raw)) return true;
    const hay = matchKey(lower);
    if (!hay) return false;
    if (keys.some((k) => hay.includes(k))) return true;
    // Все слова запроса встречаются в тексте в любом порядке («сон жалил» → «Жалил: Сон»)
    return words.some((ws) => ws.length > 1 && ws.every((w) => hay.includes(w)));
  };
}
