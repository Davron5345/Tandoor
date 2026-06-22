import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { textMatchesSearch } from '../utils/searchNormalize';
import SearchHighlight from './SearchHighlight';

export default function CounterpartySearchSelect({
  items = [],
  value,
  onChange,
  disabled = false,
  placeholder = 'Найти…',
  inputRef,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const wrapRef = useRef(null);
  const dropdownRef = useRef(null);

  const selected = useMemo(() => items.find((i) => i.id === value), [items, value]);

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return items;
    return items.filter((i) => textMatchesSearch(i.name, q));
  }, [items, search]);

  const close = () => {
    setOpen(false);
    setSearch('');
    setHighlightIndex(0);
    setDropdownStyle(null);
  };

  const pick = (id) => {
    onChange(id);
    close();
  };

  const updateDropdownPosition = () => {
    const input = wrapRef.current?.querySelector('input');
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const maxHeight = Math.min(280, Math.max(160, window.innerHeight - rect.bottom - 16));
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      maxHeight,
      zIndex: 1200,
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    updateDropdownPosition();

    const onDoc = (e) => {
      const target = e.target;
      if (wrapRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const onRelayout = () => updateDropdownPosition();

    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onRelayout);
    window.addEventListener('scroll', onRelayout, true);

    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onRelayout);
      window.removeEventListener('scroll', onRelayout, true);
    };
  }, [open]);

  useEffect(() => {
    if (highlightIndex >= filtered.length) {
      setHighlightIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlightIndex]);

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        updateDropdownPosition();
      }
      setHighlightIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && open && filtered[highlightIndex]) {
      e.preventDefault();
      pick(filtered[highlightIndex].id);
    }
  };

  const dropdown = open && dropdownStyle ? (
    <ul
      ref={dropdownRef}
      className="counterparty-search-select-dropdown"
      style={dropdownStyle}
      role="listbox"
    >
      {filtered.length === 0 ? (
        <li className="counterparty-search-select-empty">Не найдено</li>
      ) : (
        filtered.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              role="option"
              aria-selected={value === item.id}
              className={`counterparty-search-select-option${value === item.id ? ' selected' : ''}${highlightIndex === index ? ' highlighted' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item.id)}
            >
              {search.trim() ? <SearchHighlight text={item.name} query={search} /> : item.name}
            </button>
          </li>
        ))
      )}
    </ul>
  ) : null;

  return (
    <div
      ref={wrapRef}
      className={`counterparty-search-select${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
    >
      <input
        ref={inputRef}
        type="search"
        className="counterparty-search-select-input"
        placeholder={placeholder}
        value={open ? search : (selected?.name || '')}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          setHighlightIndex(0);
          if (!e.target.value.trim() && value) onChange('');
        }}
        onFocus={() => {
          setOpen(true);
          setSearch('');
          updateDropdownPosition();
        }}
        onKeyDown={onInputKeyDown}
        disabled={disabled}
        autoComplete="off"
      />
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}
