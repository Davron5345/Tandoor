import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatMoney } from '../api';
import { IconImage } from './ActionIcons';
import SearchHighlight from './SearchHighlight';
import {
  buildProductPickGroups,
  filterProductPickGroups,
  flattenProductPickGroups,
  getPickDisplayName,
  getPickMetaParts,
  getVariantPrimaryImage,
  productPickMeta,
  resolvePickFromProducts,
} from '../utils/productVariants';

function ProductThumb({ product, variant = null, className = '', compact = false }) {
  const image = variant ? getVariantPrimaryImage(variant) : product?.primary_image;
  const sizeClass = compact ? ' product-select-thumb-sm' : '';

  if (!image) {
    return (
      <div className={`product-list-thumb product-list-thumb-empty product-select-thumb${sizeClass}${className ? ` ${className}` : ''}`} aria-hidden>
        <IconImage />
      </div>
    );
  }

  return (
    <div className={`product-list-thumb-wrap product-select-thumb-wrap${sizeClass}${className ? ` ${className}` : ''}`}>
      <img src={image.url} alt="" className={`product-list-thumb product-select-thumb${sizeClass}`} loading="lazy" />
      {image.media_type === 'gif' && <span className="product-list-thumb-gif">GIF</span>}
      {!variant && (product.extra_image_count || 0) > 0 && (
        <span className="product-list-thumb-more">+{product.extra_image_count}</span>
      )}
    </div>
  );
}

function OptionMeta({ product, variant = null }) {
  const { stock, unit, price } = getPickMetaParts(product, variant);
  return (
    <span className="product-select-option-side">
      <span className="product-select-option-stock">{stock} {unit}</span>
      <span className="product-select-option-price">{formatMoney(price)}</span>
    </span>
  );
}

export default function ProductSelect({
  kinds = null,
  products,
  allProducts = [],
  value,
  onChange,
  disabled = false,
  placeholder = 'Выберите товар...',
  searchPlaceholder = 'Поиск по названию, артикулу...',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  const catalog = allProducts.length ? allProducts : products;
  const visibleProducts = useMemo(() => {
    if (!kinds?.length) return products;
    return products.filter((p) => kinds.includes(p.product_kind || 'goods'));
  }, [products, kinds]);
  const groups = useMemo(() => buildProductPickGroups(visibleProducts), [visibleProducts]);
  const filteredGroups = useMemo(
    () => filterProductPickGroups(groups, search),
    [groups, search],
  );
  const flatOptions = useMemo(
    () => flattenProductPickGroups(filteredGroups),
    [filteredGroups],
  );

  const selected = useMemo(
    () => resolvePickFromProducts(catalog, value),
    [catalog, value],
  );

  const updateDropdownPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = Math.min(480, Math.max(240, window.innerHeight * 0.45));
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(
      dropdownHeight,
      openUp ? spaceAbove : spaceBelow,
    );

    setDropdownStyle({
      position: 'fixed',
      top: openUp ? rect.top - maxHeight - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 440),
      maxHeight,
      zIndex: 1100,
    });
  };

  const close = () => {
    setOpen(false);
    setSearch('');
    setHighlightIndex(0);
    setDropdownStyle(null);
  };

  const pick = (pickValue) => {
    onChange(pickValue);
    close();
  };

  useEffect(() => {
    if (!open) return undefined;
    setHighlightIndex(0);
  }, [open, search]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      const inTrigger = triggerRef.current?.contains(e.target);
      const inDropdown = dropdownRef.current?.contains(e.target);
      if (!inTrigger && !inDropdown) close();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setDropdownStyle(null);
      return undefined;
    }

    updateDropdownPosition();
    searchRef.current?.focus({ preventScroll: true });

    const onScrollOrResize = () => updateDropdownPosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    const el = dropdownRef.current.querySelector(`[data-pick-index="${highlightIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, open, filteredGroups]);

  const handleSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((idx) => Math.min(idx + 1, Math.max(flatOptions.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((idx) => Math.max(idx - 1, 0));
    } else if (e.key === 'Enter' && flatOptions[highlightIndex]) {
      e.preventDefault();
      pick(flatOptions[highlightIndex].key);
    }
  };

  let optionIndex = -1;

  return (
    <div
      className={`product-select${open ? ' product-select-open' : ''}${disabled ? ' product-select-disabled' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="product-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
      >
        {selected.product ? (
          <>
            <ProductThumb product={selected.product} variant={selected.variant} compact />
            <span className="product-select-value">
              <span className="product-select-name">
                {getPickDisplayName(selected.product, selected.variant)}
              </span>
              <span className="product-select-meta">
                {productPickMeta(selected.product, selected.variant)}
              </span>
            </span>
          </>
        ) : (
          <span className="product-select-value product-select-value-muted">{placeholder}</span>
        )}
        <span className="product-select-chevron" aria-hidden>▾</span>
      </button>

      {open && dropdownStyle && createPortal(
        <div ref={dropdownRef} className="product-select-dropdown" style={dropdownStyle}>
          <div className="product-select-search-wrap">
            <input
              ref={searchRef}
              type="search"
              className="product-select-search"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>

          <ul className="product-select-list" role="listbox">
            {filteredGroups.map((group) => {
              const isGrouped = group.options.length > 1
                || (group.product.has_variants && group.options[0]?.variant);
              return (
                <li key={group.id} className="product-select-group">
                  {isGrouped && (
                    <div className="product-select-group-header">
                      <ProductThumb product={group.product} compact />
                      <span className="product-select-group-title">
                        {search.trim() ? (
                          <SearchHighlight text={group.product.name} query={search} />
                        ) : (
                          group.product.name
                        )}
                      </span>
                      {group.product.category_name && (
                        <span className="product-select-group-meta">{group.product.category_name}</span>
                      )}
                    </div>
                  )}
                  <ul className="product-select-group-options">
                    {group.options.map((option) => {
                      optionIndex += 1;
                      const currentIndex = optionIndex;
                      const isActive = value === option.key;
                      const isHighlighted = currentIndex === highlightIndex;
                      return (
                        <li key={option.key}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            data-pick-index={currentIndex}
                            className={`product-select-option${isActive ? ' active' : ''}${isHighlighted ? ' highlighted' : ''}${isGrouped ? ' product-select-option-nested' : ''}`}
                            onMouseEnter={() => setHighlightIndex(currentIndex)}
                            onClick={() => pick(option.key)}
                          >
                            {!isGrouped && (
                              <ProductThumb product={option.product} variant={option.variant} compact />
                            )}
                            <span className="product-select-option-text">
                              <span className="product-select-name">
                                {search.trim() ? (
                                  <SearchHighlight text={option.label} query={search} />
                                ) : (
                                  option.label
                                )}
                              </span>
                            </span>
                            <OptionMeta product={option.product} variant={option.variant} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
            {flatOptions.length === 0 && (
              <li className="product-select-empty">Ничего не найдено</li>
            )}
          </ul>

          {flatOptions.length > 0 && (
            <div className="product-select-footer">
              {flatOptions.length} {flatOptions.length === 1 ? 'позиция' : flatOptions.length < 5 ? 'позиции' : 'позиций'}
              <span className="product-select-footer-hint">↑↓ Enter</span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
