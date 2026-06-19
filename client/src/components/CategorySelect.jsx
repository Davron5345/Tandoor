import { useEffect, useMemo, useRef, useState } from 'react';

function getSelectedLabel(categories, value, emptyLabel, placeholder, tree, extraOptions = []) {
  if (!value) return emptyLabel || placeholder;

  const extra = extraOptions.find((o) => o.id === value);
  if (extra) return extra.label;

  const cat = categories.find((c) => c.id === value);
  if (!cat) return placeholder;

  if (tree && cat.parent_id) {
    const parent = categories.find((c) => c.id === cat.parent_id);
    return parent ? `${parent.name} → ${cat.name}` : cat.name;
  }

  return cat.name;
}

function buildTreeSections(categories, excludeIds, selectedId, query) {
  const q = query.trim().toLowerCase();
  const roots = categories.filter((c) => !c.parent_id && !excludeIds.includes(c.id));
  const sections = [];

  for (const root of roots) {
    const subs = categories.filter((c) => c.parent_id === root.id && !excludeIds.includes(c.id));

    if (!q) {
      sections.push({
        root,
        subs,
        showRootAsOption: subs.length === 0 || selectedId === root.id,
      });
      continue;
    }

    const rootMatch = root.name.toLowerCase().includes(q);
    const matchedSubs = subs.filter((s) => s.name.toLowerCase().includes(q));

    if (rootMatch || matchedSubs.length > 0) {
      sections.push({
        root,
        subs: rootMatch ? subs : matchedSubs,
        showRootAsOption: subs.length === 0 || selectedId === root.id || rootMatch,
      });
    }
  }

  return sections;
}

export default function CategorySelect({
  categories,
  value,
  onChange,
  tree = true,
  includeEmpty = false,
  emptyLabel = 'Все категории',
  selectedId,
  excludeIds = [],
  disabled = false,
  placeholder = 'Выберите категорию',
  searchPlaceholder = 'Поиск категории...',
  className = '',
  extraOptions = [],
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  const updateDropdownPosition = () => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 1100,
    });
  };

  const displayLabel = getSelectedLabel(
    categories,
    value,
    includeEmpty ? emptyLabel : '',
    placeholder,
    tree,
    extraOptions,
  );

  const flatItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = categories.filter((c) => !excludeIds.includes(c.id));
    if (!q) return items;
    return items.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, excludeIds, search]);

  const treeSections = useMemo(
    () => buildTreeSections(categories, excludeIds, selectedId ?? value, search),
    [categories, excludeIds, selectedId, value, search],
  );

  const hasResults = tree
    ? treeSections.length > 0
    : flatItems.length > 0 || extraOptions.some((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));
  const showEmptyOption = includeEmpty || !tree;
  const visibleExtraOptions = extraOptions.filter((o) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return o.label.toLowerCase().includes(q);
  });

  const close = () => {
    setOpen(false);
    setSearch('');
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
    if (open) {
      updateDropdownPosition();
      searchRef.current?.focus();
    } else {
      setDropdownStyle(null);
    }
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className={`category-select${open ? ' category-select-open' : ''}${disabled ? ' category-select-disabled' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className="category-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
      >
        <span className={`category-select-value${!value && includeEmpty ? ' category-select-value-muted' : ''}`}>
          {displayLabel}
        </span>
        <span className="category-select-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="category-select-dropdown" style={dropdownStyle || undefined}>
          <div className="category-select-search-wrap">
            <input
              ref={searchRef}
              type="search"
              className="category-select-search"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <ul className="category-select-list" role="listbox">
            {showEmptyOption && (!search.trim() || emptyLabel.toLowerCase().includes(search.trim().toLowerCase())) && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className={`category-select-option${!value ? ' active' : ''}`}
                  onClick={() => pick('')}
                >
                  {emptyLabel}
                </button>
              </li>
            )}

            {visibleExtraOptions.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === option.id}
                  className={`category-select-option category-select-option-filter${value === option.id ? ' active' : ''}`}
                  onClick={() => pick(option.id)}
                >
                  {option.label}
                </button>
              </li>
            ))}

            {tree ? (
              treeSections.map(({ root, subs, showRootAsOption }) => (
                <li key={root.id} className="category-select-group">
                  <div className="category-select-group-label">{root.name}</div>
                  {showRootAsOption && subs.length > 0 && (
                    <button
                      type="button"
                      role="option"
                      aria-selected={value === root.id}
                      className={`category-select-option${value === root.id ? ' active' : ''}`}
                      onClick={() => pick(root.id)}
                    >
                      {root.name}
                    </button>
                  )}
                  {subs.length === 0 ? (
                    <button
                      type="button"
                      role="option"
                      aria-selected={value === root.id}
                      className={`category-select-option${value === root.id ? ' active' : ''}`}
                      onClick={() => pick(root.id)}
                    >
                      {root.name}
                    </button>
                  ) : (
                    subs.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        role="option"
                        aria-selected={value === sub.id}
                        className={`category-select-option category-select-option-sub${value === sub.id ? ' active' : ''}`}
                        onClick={() => pick(sub.id)}
                      >
                        {sub.name}
                      </button>
                    ))
                  )}
                </li>
              ))
            ) : (
              flatItems.map((cat) => (
                <li key={cat.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === cat.id}
                    className={`category-select-option${value === cat.id ? ' active' : ''}`}
                    onClick={() => pick(cat.id)}
                  >
                    {cat.name}
                  </button>
                </li>
              ))
            )}

            {!hasResults && visibleExtraOptions.length === 0 && !(showEmptyOption && !search.trim()) && (
              <li className="category-select-empty">Ничего не найдено</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
