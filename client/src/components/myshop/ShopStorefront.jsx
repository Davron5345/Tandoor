import { useMemo } from 'react';
import { formatMoney } from '../../api';
import { IconImage } from '../ActionIcons';
import { getBlockMeta } from '../../utils/myShopLayout';

export function formatShopPrice(product) {
  if (product.has_variants && product.variant_price_min != null) {
    if (product.variant_price_max != null && product.variant_price_min !== product.variant_price_max) {
      return `от ${formatMoney(product.variant_price_min)}`;
    }
    return formatMoney(product.variant_price_min);
  }
  return formatMoney(product.price);
}

function buildCategoryImageMap(products) {
  const map = new Map();
  for (const product of products) {
    if (product.category_id && product.primary_image && !map.has(product.category_id)) {
      map.set(product.category_id, product.primary_image.url);
    }
  }
  return map;
}

function buildCategoryProductMap(products) {
  const map = new Map();
  for (const product of products) {
    if (!product.category_id) continue;
    if (!map.has(product.category_id)) map.set(product.category_id, []);
    map.get(product.category_id).push(product);
  }
  return map;
}

export function ShopMedia({ image, name, outside = false, emptyClassName = '' }) {
  if (!image) {
    return (
      <div className={`myshop-media myshop-media-empty ${emptyClassName}`.trim()} aria-hidden>
        <IconImage />
      </div>
    );
  }

  return (
    <div className={`myshop-media${outside ? ' myshop-media-outside' : ''}`}>
      <img src={image.url || image} alt={name || ''} loading="lazy" />
      {image.media_type === 'gif' && <span className="myshop-media-badge">GIF</span>}
    </div>
  );
}

function CategoryTile({ category, imageUrl, photoOutside, onClick }) {
  return (
    <button
      type="button"
      className={`myshop-cat-tile${photoOutside ? ' myshop-cat-tile-outside' : ''}`}
      onClick={onClick ? () => onClick(category.id) : undefined}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="myshop-cat-tile-img" loading="lazy" />
      ) : (
        <div className="myshop-cat-tile-placeholder"><IconImage /></div>
      )}
      <span className="myshop-cat-tile-label">{category.name}</span>
    </button>
  );
}

function CategoryGridBlock({ block, categoriesById, categoryImages, settings, onCategoryClick }) {
  const meta = getBlockMeta(block.type);
  const items = block.categoryIds
    .map((id) => categoriesById.get(id))
    .filter(Boolean);

  if (!items.length) {
    return <div className="myshop-block-empty">Добавьте категории в блок</div>;
  }

  return (
    <div className={`myshop-block-grid myshop-block-${meta.layout}`}>
      {items.map((category) => (
        <CategoryTile
          key={category.id}
          category={category}
          imageUrl={categoryImages.get(category.id)}
          photoOutside={settings.photoOutside}
          onClick={onCategoryClick}
        />
      ))}
    </div>
  );
}

function SliderBlock({
  block,
  categoriesById,
  categoryImages,
  productsByCategory,
  settings,
  onProductOpen,
  onCategoryClick,
}) {
  const sections = block.categoryIds
    .map((id) => categoriesById.get(id))
    .filter(Boolean);

  if (!sections.length) {
    return <div className="myshop-block-empty">Добавьте категории в слайдер</div>;
  }

  return (
    <div className="myshop-block-slider-wrap">
      {sections.map((category) => {
        const products = (productsByCategory.get(category.id) || []).slice(0, 6);
        return (
          <section key={category.id} className="myshop-block-slider-section">
            <div className="myshop-block-section-head">
              <h3>{block.title || category.name}</h3>
              {onCategoryClick && (
                <button type="button" className="myshop-link-btn" onClick={() => onCategoryClick(category.id)}>
                  Все →
                </button>
              )}
            </div>
            <div className="myshop-block-slider-rail">
              <CategoryTile
                category={category}
                imageUrl={categoryImages.get(category.id)}
                photoOutside={settings.photoOutside}
                onClick={onCategoryClick}
              />
            </div>
            {products.length > 0 && (
              <div className="myshop-grid myshop-grid-compact">
                {products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    className="myshop-card"
                    onClick={() => onProductOpen?.(product)}
                  >
                    <ShopMedia image={product.primary_image} name={product.name} />
                    <div className="myshop-card-body">
                      <div className="myshop-card-name">{product.name}</div>
                      <div className="myshop-card-price">{formatShopPrice(product)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ShopBlock({
  block,
  categoriesById,
  categoryImages,
  productsByCategory,
  settings,
  onProductOpen,
  onCategoryClick,
}) {
  const meta = getBlockMeta(block.type);
  const isSlider = block.type === 'slider';

  return (
    <section className={`myshop-block${settings.transparentBackground ? ' myshop-block-transparent' : ''}`}>
      {!isSlider && block.title && (
        <div className="myshop-block-section-head">
          <h3>{block.title}</h3>
        </div>
      )}
      {isSlider ? (
        <SliderBlock
          block={block}
          categoriesById={categoriesById}
          categoryImages={categoryImages}
          productsByCategory={productsByCategory}
          settings={settings}
          onProductOpen={onProductOpen}
          onCategoryClick={onCategoryClick}
        />
      ) : (
        <CategoryGridBlock
          block={block}
          categoriesById={categoriesById}
          categoryImages={categoryImages}
          settings={settings}
          onCategoryClick={onCategoryClick}
        />
      )}
      {!isSlider && meta.max != null && (
        <div className="myshop-block-head-meta">
          <span className="myshop-block-type">{meta.shortLabel}</span>
          <span className="myshop-block-count">{block.categoryIds.length}/{meta.max}</span>
        </div>
      )}
    </section>
  );
}

export default function ShopStorefront({
  layout,
  categories = [],
  products = [],
  branchName,
  search = '',
  onSearchChange,
  activeCategoryId = '',
  onCategoryClick,
  onProductOpen,
  preview = false,
}) {
  const settings = layout?.settings || {};
  const blocks = layout?.blocks || [];
  const hasBlocks = blocks.length > 0;

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryImages = useMemo(() => buildCategoryImageMap(products), [products]);
  const productsByCategory = useMemo(() => buildCategoryProductMap(products), [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((product) => {
      if (activeCategoryId && product.category_id !== activeCategoryId) return false;
      if (!q) return true;
      const haystack = [
        product.name,
        product.category_name,
        product.parent_category_name,
        product.sku,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [products, search, activeCategoryId]);

  const pageClass = [
    'myshop-page',
    preview ? 'myshop-page-preview' : '',
    settings.hideBackground ? 'myshop-page-hide-bg' : '',
    settings.transparentBackground ? 'myshop-page-transparent' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={pageClass}>
      <header className="myshop-header">
        <div className="myshop-brand">
          <span className="myshop-brand-mark" aria-hidden>MS</span>
          <div>
            <strong>MyShop</strong>
            <span>{branchName}</span>
          </div>
        </div>
      </header>

      {settings.showcase !== false && (
        <div className="myshop-search-wrap">
          <input
            type="search"
            className="myshop-search"
            placeholder="Поиск товаров"
            value={search}
            onChange={onSearchChange ? (e) => onSearchChange(e.target.value) : undefined}
            readOnly={!onSearchChange}
          />
        </div>
      )}

      {hasBlocks ? (
        <div className="myshop-blocks">
          {blocks.map((block) => (
            <ShopBlock
              key={block.id}
              block={block}
              categoriesById={categoriesById}
              categoryImages={categoryImages}
              productsByCategory={productsByCategory}
              settings={settings}
              onProductOpen={onProductOpen}
              onCategoryClick={onCategoryClick}
            />
          ))}
        </div>
      ) : (
        <div className="myshop-fallback-grid">
          {filteredProducts.length === 0 ? (
            <div className="myshop-empty">Нет товаров</div>
          ) : (
            <div className="myshop-grid">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="myshop-card"
                  onClick={() => onProductOpen?.(product)}
                >
                  <ShopMedia image={product.primary_image} name={product.name} />
                  <div className="myshop-card-body">
                    <div className="myshop-card-name">{product.name}</div>
                    <div className="myshop-card-price">{formatShopPrice(product)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {settings.menu !== false && (
        <nav className="myshop-bottom-nav" aria-label="Меню магазина">
          <button type="button" className="myshop-bottom-nav-item active">Меню</button>
          <button type="button" className="myshop-bottom-nav-item">Избранные</button>
          <button type="button" className="myshop-bottom-nav-item">Корзина</button>
        </nav>
      )}
    </div>
  );
}
