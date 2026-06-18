/** Локальная дата YYYY-MM-DD (не UTC — важно для кассовой смены). */
export function todayLocalIso(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
