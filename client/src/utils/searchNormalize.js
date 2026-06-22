const EN_TO_RU = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
  '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л',
  l: 'д', ';': 'ж', "'": 'э', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь',
  ',': 'б', '.': 'ю', '/': '.', '`': 'ё',
};

const RU_TO_EN = Object.fromEntries(
  Object.entries(EN_TO_RU).map(([en, ru]) => [ru, en]),
);

const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', қ: 'q', ғ: "g'", ҳ: 'h', ў: "o'",
};

const LATIN_TO_CYRILLIC = {
  sch: 'щ', ch: 'ч', ts: 'ц', yo: 'ё', yu: 'ю', ya: 'я', sh: 'ш',
  "g'": 'ғ', "o'": 'ў', q: 'к', a: 'а', b: 'б', c: 'с', d: 'д', e: 'е', f: 'ф',
  g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з',
};

export function swapKeyboardLayout(text, direction = 'en_to_ru') {
  const map = direction === 'ru_to_en' ? RU_TO_EN : EN_TO_RU;
  return [...text].map((ch) => {
    const lower = ch.toLowerCase();
    const mapped = map[lower];
    if (!mapped) return ch;
    return ch === lower ? mapped : mapped.toUpperCase();
  }).join('').toLowerCase();
}

export function cyrillicToLatin(text) {
  let result = '';
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i += 1) {
    const ch = lower[i];
    result += CYRILLIC_TO_LATIN[ch] ?? ch;
  }
  return result;
}

export function latinToCyrillic(text) {
  let result = '';
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length;) {
    let matched = false;
    for (const len of [4, 3, 2]) {
      const part = lower.slice(i, i + len);
      if (LATIN_TO_CYRILLIC[part]) {
        result += LATIN_TO_CYRILLIC[part];
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = lower[i];
    result += LATIN_TO_CYRILLIC[ch] ?? ch;
    i += 1;
  }
  return result;
}

function addQKVariants(term, terms) {
  if (term.includes('q')) terms.add(term.replace(/q/g, 'к'));
  if (term.includes('к')) terms.add(term.replace(/к/g, 'q'));
}

export function expandSearchTerms(query) {
  const raw = (query || '').trim().toLowerCase();
  if (!raw) return [];

  const terms = new Set([raw]);
  const add = (value) => {
    const v = (value || '').trim().toLowerCase();
    if (v) terms.add(v);
  };

  add(swapKeyboardLayout(raw, 'en_to_ru'));
  add(swapKeyboardLayout(raw, 'ru_to_en'));

  const snapshot = [...terms];
  for (const base of snapshot) {
    add(cyrillicToLatin(base));
    add(latinToCyrillic(base));
    addQKVariants(base, terms);
  }

  const secondPass = [...terms];
  for (const base of secondPass) {
    add(swapKeyboardLayout(base, 'en_to_ru'));
    add(swapKeyboardLayout(base, 'ru_to_en'));
    addQKVariants(base, terms);
  }

  return [...terms].filter((term) => term.length > 0);
}

export function textMatchesSearch(haystack, query) {
  const h = (haystack || '').toLowerCase();
  if (!query?.trim()) return true;

  const queryTerms = expandSearchTerms(query);
  if (queryTerms.some((term) => h.includes(term))) return true;

  const hayTerms = expandSearchTerms(haystack);
  const normalizedQuery = query.trim().toLowerCase();
  return hayTerms.some((term) => term.includes(normalizedQuery)
    || queryTerms.some((q) => term.includes(q)));
}
