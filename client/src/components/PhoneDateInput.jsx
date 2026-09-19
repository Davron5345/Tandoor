/** Compact 1C-style date: readable label + native picker on tap. */
export function formatPhoneDate(value) {
  if (!value) return '—';
  const str = String(value).slice(0, 10);
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = iso
    ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    : new Date(`${str}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date
    .toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    .replace(/\s*г\.?\s*$/u, '');
}

export default function PhoneDateInput({
  value = '',
  onChange,
  disabled = false,
  min,
  max,
  className = '',
  'aria-label': ariaLabel = 'Дата',
}) {
  return (
    <label
      className={`phone-date-input${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
    >
      <span className="phone-date-input-text">{formatPhoneDate(value)}</span>
      <input
        type="date"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  );
}
