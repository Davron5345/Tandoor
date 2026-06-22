import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconColumns } from './ActionIcons';
import {
  DEFAULT_VISIBLE_COLUMNS,
  getToggleableProductColumns,
  writeProductTableColumns,
} from '../utils/productTableColumns';

export default function ProductTableColumnsMenu({
  visibleColumns,
  onChange,
  showShopColumn = false,
}) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  const toggleableColumns = useMemo(
    () => getToggleableProductColumns({ showShopColumn }),
    [showShopColumn],
  );

  const hiddenCount = toggleableColumns.filter((col) => !visibleColumns.has(col.id)).length;

  const updateDropdownPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = 240;
    const left = Math.min(rect.left, window.innerWidth - dropdownWidth - 12);
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: Math.max(12, left),
      width: dropdownWidth,
      zIndex: 1100,
    });
  };

  const close = () => {
    setOpen(false);
    setDropdownStyle(null);
  };

  const toggleColumn = (columnId) => {
    const next = new Set(visibleColumns);
    if (next.has(columnId)) next.delete(columnId);
    else next.add(columnId);
    writeProductTableColumns(next);
    onChange(next);
  };

  const resetColumns = () => {
    const next = new Set(DEFAULT_VISIBLE_COLUMNS);
    writeProductTableColumns(next);
    onChange(next);
  };

  useEffect(() => {
    if (!open) return undefined;

    updateDropdownPosition();

    const onDocClick = (e) => {
      const target = e.target;
      if (wrapRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };
    const onRelayout = () => updateDropdownPosition();

    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onRelayout);
    window.addEventListener('scroll', onRelayout, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onRelayout);
      window.removeEventListener('scroll', onRelayout, true);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={`product-columns-menu${open ? ' is-open' : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`product-columns-menu-trigger${hiddenCount > 0 ? ' is-active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        title="Колонки таблицы"
        onClick={() => setOpen((prev) => !prev)}
      >
        <IconColumns />
        <span className="product-columns-menu-label">Колонки</span>
        {hiddenCount > 0 && (
          <span className="product-columns-menu-badge">{hiddenCount}</span>
        )}
      </button>

      {open && dropdownStyle && createPortal(
        <div ref={dropdownRef} className="product-columns-menu-dropdown" style={dropdownStyle}>
          <div className="product-columns-menu-head">Видимые колонки</div>
          <ul className="product-columns-menu-list">
            {toggleableColumns.map((col) => (
              <li key={col.id}>
                <label className="product-columns-menu-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(col.id)}
                    onChange={() => toggleColumn(col.id)}
                  />
                  <span>{col.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="product-columns-menu-footer">
            <button type="button" className="product-columns-menu-reset" onClick={resetColumns}>
              Показать все
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
