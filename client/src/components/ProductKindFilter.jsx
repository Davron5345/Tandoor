import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

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
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
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

    updateDropdownPosition();

    const onDocClick = (e) => {
      const target = e.target;
      if (
        wrapRef.current?.contains(target)
        || dropdownRef.current?.contains(target)
      ) return;
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

  const dropdown = open && dropdownStyle ? (
    <div
      ref={dropdownRef}
      className="kind-filter-dropdown"
      style={dropdownStyle}
    >
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
  ) : null;

  return (
    <div
      ref={wrapRef}
      className={`kind-filter-menu${open ? ' kind-filter-menu-open' : ''}${isFiltered ? ' kind-filter-menu-active' : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="kind-filter-trigger"
        title={isFiltered ? `Фильтр: ${activeItem.label}` : 'Фильтр по виду'}
        aria-label="Фильтр по виду номенклатуры"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setOpen(true);
        }}
      >
        <IconFilter />
        {isFiltered && <span className="kind-filter-trigger-dot" aria-hidden />}
      </button>

      {dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}
