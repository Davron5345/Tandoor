import { useMemo, useState } from 'react';

export default function SupplierMultiSelect({
  suppliers,
  value = [],
  onChange,
  searchPlaceholder = 'Поиск поставщика...',
  emptyMessage = 'Нет поставщиков. Добавьте их в разделе «Контрагенты».',
  disabled = false,
}) {
  const [search, setSearch] = useState('');

  const selectedSet = useMemo(() => new Set(value), [value]);

  const matchingSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => !q || s.name.toLowerCase().includes(q));
  }, [suppliers, search]);

  const displaySuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers
      .filter((s) => {
        if (selectedSet.has(s.id)) return true;
        if (!q) return true;
        return s.name.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const aSelected = selectedSet.has(a.id);
        const bSelected = selectedSet.has(b.id);
        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        return a.name.localeCompare(b.name, 'ru');
      });
  }, [suppliers, search, selectedSet]);

  const toggle = (supplierId) => {
    if (disabled) return;
    if (selectedSet.has(supplierId)) {
      onChange(value.filter((id) => id !== supplierId));
      return;
    }
    onChange([...value, supplierId]);
  };

  const clearAll = () => {
    if (disabled || value.length === 0) return;
    onChange([]);
  };

  const selectAll = () => {
    if (disabled || matchingSuppliers.length === 0) return;
    const ids = new Set(value);
    matchingSuppliers.forEach((s) => ids.add(s.id));
    onChange([...ids]);
  };

  const allMatchingSelected = matchingSuppliers.length > 0
    && matchingSuppliers.every((s) => selectedSet.has(s.id));

  if (suppliers.length === 0) {
    return <p className="product-meta">{emptyMessage}</p>;
  }

  return (
    <div className="supplier-picker">
      <div className="supplier-picker-toolbar">
        <input
          type="search"
          className="supplier-picker-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          disabled={disabled}
          autoComplete="off"
        />
        <span className="supplier-picker-count">
          {value.length} из {suppliers.length}
        </span>
        {!disabled && matchingSuppliers.length > 0 && !allMatchingSelected && (
          <button type="button" className="supplier-picker-action" onClick={selectAll}>
            Выбрать все
          </button>
        )}
        {value.length > 0 && !disabled && (
          <button type="button" className="supplier-picker-action" onClick={clearAll}>
            Снять все
          </button>
        )}
      </div>

      {value.length > 0 && (
        <div className="supplier-picker-chips">
          {suppliers
            .filter((s) => selectedSet.has(s.id))
            .map((s) => (
              <button
                key={s.id}
                type="button"
                className="supplier-picker-chip"
                onClick={() => toggle(s.id)}
                disabled={disabled}
                title="Снять выбор"
              >
                {s.name}
                <span aria-hidden="true">×</span>
              </button>
            ))}
        </div>
      )}

      <div className="supplier-list supplier-picker-list">
        {displaySuppliers.length === 0 ? (
          <div className="supplier-picker-empty">Ничего не найдено</div>
        ) : (
          displaySuppliers.map((s) => (
            <label
              key={s.id}
              className={`supplier-option${selectedSet.has(s.id) ? ' supplier-option-selected' : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedSet.has(s.id)}
                onChange={() => toggle(s.id)}
                disabled={disabled}
              />
              <span>{s.name}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
