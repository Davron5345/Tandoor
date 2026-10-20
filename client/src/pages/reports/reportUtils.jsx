

export function formatQty(n) {
  const rounded = Math.round((Number(n) || 0) * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(rounded);
}

export function SortHeader({ label, sortKey, activeKey, direction, onSort, className = '' }) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`sortable-th ${className}${active ? ' is-sorted' : ''}`}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="sortable-th-btn"
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <span className="sortable-th-icons" aria-hidden="true">
          <span className={`sort-arrow up${active && direction === 'asc' ? ' active' : ''}`}>▲</span>
          <span className={`sort-arrow down${active && direction === 'desc' ? ' active' : ''}`}>▼</span>
        </span>
      </button>
    </th>
  );
}
