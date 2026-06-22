import { useEffect, useMemo, useRef, useState } from 'react';
import { IconFilter } from './ActionIcons';
import { PRODUCT_KINDS, PRODUCT_KIND_LABELS_PLURAL } from '../productKinds';

function formatCount(value) {
  if (value == null) return null;
  return value > 999 ? '999+' : String(value);
}

export default function ProductKindFilter({ value, onChange, counts = {} }) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const wrapRef = useRef(null);

  const items = useMemo(() => [
    { id: '', label: 'Все виды' },
    ...PRODUCT_KINDS.map((kindId) => ({
      id: kindId,
      label: PRODUCT_KIND_LABELS_PLURAL[kindId],
    })),
  ], []);

  const activeItem = items.find((item) => (value || '') === item.id) || items[0];
  const isFiltered = Boolean(value);

  const updateDropdownPosition = () => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      minWidth: Math.max(rect.width, 220),
      zIndex: 1100,
    });
  };

  const close = () => {
    setOpen(false);
    setDropdownStyle(null);
  };

  const pick = (id) => {
    onChange(id);
    close();
  };

  useEffect(() => {
    if (!open) return undefined;

    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) updateDropdownPosition();
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={`kind-filter-menu${open ? ' kind-filter-menu-open' : ''}${isFiltered ? ' kind-filter-menu-active' : ''}`}
    >
      <button
        type="button"
        className="kind-filter-trigger"
        title={isFiltered ? `Фильтр: ${activeItem.label}` : 'Фильтр по виду'}
        aria-label="Фильтр по виду номенклатуры"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <IconFilter />
        {isFiltered && <span className="kind-filter-trigger-dot" aria-hidden />}
      </button>

      {open && (
        <div className="kind-filter-dropdown" style={dropdownStyle || undefined}>
          <div className="kind-filter-dropdown-title">Вид номенклатуры</div>
          <ul className="kind-filter-list" role="listbox">
            {items.map((item) => {
              const active = (value || '') === item.id;
              const count = item.id ? counts[item.id] : counts.all;
              const countLabel = formatCount(count);

              return (
                <li key={item.id || 'all'}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`kind-filter-option${active ? ' active' : ''}`}
                    onClick={() => pick(item.id)}
                  >
                    <span>{item.label}</span>
                    {countLabel != null && (
                      <span className="kind-filter-option-count">{countLabel}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
