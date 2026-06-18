export function IconButton({ title, onClick, children, danger = false, success = false, disabled = false, className = '' }) {
  const variant = danger ? ' btn-icon-danger' : success ? ' btn-icon-success' : '';
  return (
    <button
      type="button"
      className={`btn btn-icon btn-ghost btn-sm${variant}${className ? ` ${className}` : ''}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20h9" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCopy() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AddRowButton({ onClick, disabled = false, label = 'Строка' }) {
  return (
    <button
      type="button"
      className="btn-add-row"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="btn-add-row-plus" aria-hidden="true">+</span>
      {label}
    </button>
  );
}

export function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M6 6l1 14h10l1-14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M10 10v6M14 10v6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function IconArrowUp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19V5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M7 10l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconArrowDown() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M7 14l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconEye() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 4v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v5l3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTelegram() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 4L3 11l7 2 2 7 9-16z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 13l8-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconUndo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7v6h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 2.7L3 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconWallet() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h14a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M17 14h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 7V6a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconMore() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function IconTransfer() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 3l3 4-3 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 17H6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 21l-3-4 3-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
