import { useEffect, useMemo, useRef, useState } from 'react';
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
  const wrapRef = useRef(null);

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
  };

  const pick = (id) => {
    onChange(id);
    close();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
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
      if (!open) setOpen(true);
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
        }}
        onKeyDown={onInputKeyDown}
        disabled={disabled}
        autoComplete="off"
      />
      {open && (
        <ul className="counterparty-search-select-dropdown" role="listbox">
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
      )}
    </div>
  );
}
