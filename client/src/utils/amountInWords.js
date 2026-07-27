/**
 * Сумма прописью (русский, целые суммы в сумах).
 * Пример: 1000 → «одна тысяча сум»
 */
const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
];
const TENS = [
  '', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
  'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто',
];
const HUNDREDS = [
  '', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
  'шестьсот', 'семьсот', 'восемьсот', 'девятьсот',
];

function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function triadToWords(n, feminine) {
  const ones = feminine ? ONES_F : ONES_M;
  const parts = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) parts.push(HUNDREDS[h]);
  if (t === 1) {
    parts.push(TEENS[o]);
  } else {
    if (t) parts.push(TENS[t]);
    if (o) parts.push(ones[o]);
  }
  return parts.join(' ');
}

/**
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function amountInWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'ноль сум';

  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  const parts = [];
  if (billions) {
    parts.push(triadToWords(billions, false));
    parts.push(plural(billions, 'миллиард', 'миллиарда', 'миллиардов'));
  }
  if (millions) {
    parts.push(triadToWords(millions, false));
    parts.push(plural(millions, 'миллион', 'миллиона', 'миллионов'));
  }
  if (thousands) {
    parts.push(triadToWords(thousands, true));
    parts.push(plural(thousands, 'тысяча', 'тысячи', 'тысяч'));
  }
  if (rest) {
    parts.push(triadToWords(rest, false));
  }

  const text = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'ноль сум';
  return `${text} сум`;
}

/** С заглавной буквы: «Одна тысяча сум» */
export function amountInWordsCapitalized(value) {
  const text = amountInWords(value);
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
