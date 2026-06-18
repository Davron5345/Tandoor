const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugFromLabel(label) {
  const lower = (label || '').trim().toLowerCase();
  let result = '';
  for (const char of lower) {
    if (TRANSLIT[char] !== undefined) result += TRANSLIT[char];
    else if (/[a-z0-9]/.test(char)) result += char;
    else if (/\s|-/.test(char)) result += '_';
  }
  return result.replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').slice(0, 32);
}
