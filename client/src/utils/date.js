/** Локальная дата YYYY-MM-DD (не UTC — важно для кассовой смены). */
export function todayLocalIso(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** Период YYYY-MM-DD по году и месяцу (1–12). Пустые значения — без ограничения. */
export function isoMonthYearRange(year, month) {
  const y = Number(year) || 0;
  const m = Number(month) || 0;
  if (!y && !m) return { date_from: '', date_to: '' };
  const useYear = y || new Date().getFullYear();
  if (!m) {
    return { date_from: `${useYear}-01-01`, date_to: `${useYear}-12-31` };
  }
  const last = new Date(useYear, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return {
    date_from: `${useYear}-${mm}-01`,
    date_to: `${useYear}-${mm}-${String(last).padStart(2, '0')}`,
  };
}

export function recentYearOptions(span = 6) {
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now; y >= now - span; y -= 1) years.push(y);
  return years;
}
