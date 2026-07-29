import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { textMatchesSearch } from '../utils/searchNormalize';
import SearchHighlight from './SearchHighlight';

/**
 * Compact multi-select for report toolbars: trigger looks like a filter select,
 * dropdown with search + checkboxes (portal).
 */
export default function ReportSupplierMultiSelect({
  suppliers = [],
  value = [],
  onChange,
  disabled = false,
  placeholder = 'Все поставщики',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menuStyle, setMenuStyle] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selectedSet = useMemo(() => new Set(value), [value]);

  const matching = useMemo(() => {
    const q = search.trim();
    return suppliers.filter((s) => !q || textMatchesSearch(s.name, q));
  }, [suppliers, search]);

  const label = useMemo(() => {
    if (value.length === 0) return placeholder;
    if (value.length === 1) {
      return suppliers.find((s) => s.id === value[0])?.name || '1 поставщик';
    }
    return `Выбрано: ${value.length}`;
  }, [value, suppliers, placeholder]);

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }
    const update = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const width = Math.max(rect.width, 280);
      const left = Math.min(rect.left, window.innerWidth - width - 12);
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const maxHeight = Math.min(360, Math.max(180, spaceBelow > 200 ? spaceBelow : rect.top - 8));
      const openUp = spaceBelow < 220 && rect.top > spaceBelow;
      setMenuStyle({
        position: 'fixed',
        left: Math.max(12, left),
        width,
        maxHeight,
        zIndex: 1100,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    };
    update();
    const onPointer = (e) => {
      const t = e.target;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const toggle = (id) => {
    if (disabled) return;
    if (selectedSet.has(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  const selectAllMatching = () => {
    if (disabled || matching.length === 0) return;
    const next = new Set(value);
    matching.forEach((s) => next.add(s.id));
    onChange([...next]);
  };

  const clearAll = () => {
    if (disabled || value.length === 0) return;
    onChange([]);
  };

  const allMatchingSelected = matching.length > 0
    && matching.every((s) => selectedSet.has(s.id));

  return (
    <div className={`report-supplier-multi${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="report-supplier-multi-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="report-supplier-multi-label">{label}</span>
        <span className="report-supplier-multi-chevron" aria-hidden="true">▾</span>
      </button>
      {open && menuStyle && createPortal(
        <div
          ref={menuRef}
          className="report-supplier-multi-menu"
          role="listbox"
          aria-multiselectable="true"
          style={menuStyle}
        >
          <div className="report-supplier-multi-toolbar">
            <input
              type="search"
              className="report-supplier-multi-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск…"
              autoComplete="off"
              autoFocus
            />
            <div className="report-supplier-multi-actions">
              {!allMatchingSelected && matching.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllMatching}>
                  Все
                </button>
              )}
              {value.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
                  Сбросить
                </button>
              )}
            </div>
          </div>
          <div className="report-supplier-multi-list">
            {matching.length === 0 ? (
              <div className="report-supplier-multi-empty">Ничего не найдено</div>
            ) : (
              matching.map((s) => (
                <label
                  key={s.id}
                  className={`report-supplier-multi-option${selectedSet.has(s.id) ? ' is-selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                  <span>
                    {search.trim()
                      ? <SearchHighlight text={s.name} query={search} />
                      : s.name}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
