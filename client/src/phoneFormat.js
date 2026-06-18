export function formatUzPhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (!digits) return '';

  let normalized = digits;

  if (normalized.startsWith('998')) {
    normalized = normalized.slice(0, 12);
  } else if (normalized.startsWith('8')) {
    normalized = (`998${normalized.slice(1)}`).slice(0, 12);
  } else {
    normalized = (`998${normalized}`).slice(0, 12);
  }

  const local = normalized.startsWith('998') ? normalized.slice(3) : normalized.slice(0, 9);
  if (!local) return '+998';

  let formatted = '+998';
  if (local.length <= 2) return `${formatted}-${local}`;

  formatted += `-${local.slice(0, 2)}`;
  if (local.length <= 2) return formatted;

  formatted += `-${local.slice(2, 5)}`;
  if (local.length <= 5) return formatted;

  formatted += `-${local.slice(5, 7)}`;
  if (local.length <= 7) return formatted;

  return `${formatted}-${local.slice(7, 9)}`;
}
