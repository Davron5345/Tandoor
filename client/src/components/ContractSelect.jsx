import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconTrash } from './ActionIcons';

/**
 * Выбор договора с иконкой удаления для неиспользованных договоров.
 */
export default function ContractSelect({
  contracts = [],
  value = '',
  onChange,
  onDelete,
  disabled = false,
  canDelete = false,
  emptyLabel = '— выберите договор —',
  showEmptyOption = false,
  formatLabel,
  valueLabel = '',
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const selected = contracts.find((c) => c.id === value) || null;
  const label = selected
    ? (formatLabel ? formatLabel(selected) : selected.number)
    : (value && valueLabel
      ? valueLabel
      : (showEmptyOption ? emptyLabel : (contracts[0] ? (formatLabel ? formatLabel(contracts[0]) : contracts[0].number) : emptyLabel)));

  const close = () => {
    setOpen(false);
    setMenuStyle(null);
  };

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const maxHeight = Math.min(280, window.innerHeight - rect.bottom - 12);
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 240),
      maxHeight: Math.max(120, maxHeight),
      zIndex: 1200,
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = () => updatePosition();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const pick = (id) => {
    onChange?.(id);
    close();
  };

  const canShowDelete = (c) => (
    canDelete
    && typeof onDelete === 'function'
    && c
    && !c.virtual
    && c.id !== '__default__'
    && !c.is_used
  );

  return (
    <div className={`contract-select${open ? ' contract-select-open' : ''}${disabled ? ' contract-select-disabled' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="contract-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
      >
        <span className={`contract-select-value${!selected && showEmptyOption ? ' contract-select-value-muted' : ''}`}>
          {label}
        </span>
        <span className="contract-select-chevron" aria-hidden>▾</span>
      </button>

      {open && menuStyle && createPortal(
        <div ref={menuRef} className="contract-select-menu" style={menuStyle} role="listbox">
          {showEmptyOption && (
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`contract-select-option${!value ? ' active' : ''}`}
              onClick={() => pick('')}
            >
              <span className="contract-select-option-label">{emptyLabel}</span>
            </button>
          )}
          {contracts.map((c) => (
            <div key={c.id} className="contract-select-option-row">
              <button
                type="button"
                role="option"
                aria-selected={value === c.id}
                className={`contract-select-option${value === c.id ? ' active' : ''}`}
                onClick={() => pick(c.id)}
              >
                <span className="contract-select-option-label">
                  {formatLabel ? formatLabel(c) : c.number}
                </span>
              </button>
              {canShowDelete(c) && (
                <button
                  type="button"
                  className="contract-select-option-delete"
                  title="Удалить договор"
                  aria-label={`Удалить ${c.number}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(c);
                  }}
                >
                  <IconTrash />
                </button>
              )}
            </div>
          ))}
          {contracts.length === 0 && !showEmptyOption && (
            <div className="contract-select-empty">Нет договоров</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
