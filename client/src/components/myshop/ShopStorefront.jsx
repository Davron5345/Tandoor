import { useMemo } from 'react';
import { formatMoney } from '../../api';
import { IconImage } from '../ActionIcons';
import { IconNavShop } from '../NavIcons';
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
    const categoryIds = [product.category_id, product.category_parent_id].filter(Boolean);
    for (const categoryId of categoryIds) {
      if (!map.has(categoryId)) map.set(categoryId, []);
      if (!map.get(categoryId).some((p) => p.id === product.id)) {
        map.get(categoryId).push(product);
      }
    }
  }
  return map;
}

function productMatchesCategory(product, categoryId) {
  if (!categoryId) return true;
  return product.category_id === categoryId || product.category_parent_id === categoryId;
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

function CategoryTile({ category, imageUrl, photoOutside, onClick, active = false }) {
  return (
    <button
      type="button"
      className={`myshop-cat-tile${photoOutside ? ' myshop-cat-tile-outside' : ''}${active ? ' is-active' : ''}`}
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

function ShopProductCard({ product, onOpen, publicMode = false }) {
  const inStock = product.has_variants
    ? (product.variants || []).some((v) => (v.stock || 0) > 0)
    : (product.stock || 0) > 0;

  return (
    <article className={`myshop-product-card${!inStock ? ' is-out-of-stock' : ''}`}>
      <button
        type="button"
        className="myshop-product-card-media-btn"
        onClick={() => onOpen?.(product)}
        aria-label={product.name}
      >
        <ShopMedia image={product.primary_image} name={product.name} />
        {!inStock && <span className="myshop-product-badge">Нет в наличии</span>}
      </button>
      <div className="myshop-product-card-body">
        <button type="button" className="myshop-product-card-name" onClick={() => onOpen?.(product)}>
          {product.name}
        </button>
        <div className="myshop-product-card-footer">
          <span className="myshop-product-card-price">{formatShopPrice(product)}</span>
          {publicMode && inStock && (
            <button
              type="button"
              className="myshop-product-add-btn"
              onClick={() => onOpen?.(product)}
              aria-label={`Добавить ${product.name}`}
            >
              +
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function ProductGrid({ products, onProductOpen, publicMode = false, emptyText = 'Нет товаров' }) {
  if (!products.length) {
    return <div className="myshop-empty">{emptyText}</div>;
  }

  return (
    <div className="myshop-grid">
      {products.map((product) => (
        <ShopProductCard
          key={product.id}
          product={product}
          onOpen={onProductOpen}
          publicMode={publicMode}
        />
      ))}
    </div>
  );
}

function CategoryCatalogView({
  category,
  products,
  search,
  onBack,
  onProductOpen,
  publicMode,
}) {
  const title = category?.name || 'Каталог';

  return (
    <section className="myshop-category-view">
      <div className="myshop-category-view-head">
        <button type="button" className="myshop-back-btn" onClick={onBack}>
          ← Назад
        </button>
        <div>
          <h2>{title}</h2>
          <span>{products.length} товаров</span>
        </div>
      </div>
      {search.trim() && (
        <div className="myshop-category-view-note">Поиск: «{search.trim()}»</div>
      )}
      <ProductGrid
        products={products}
        onProductOpen={onProductOpen}
        publicMode={publicMode}
        emptyText="В этой категории пока нет товаров"
      />
    </section>
  );
}

function CategoryGridBlock({
  block,
  categoriesById,
  categoryImages,
  settings,
  onCategoryClick,
  publicMode = false,
  productsByCategory,
  onProductOpen,
  activeCategoryId = '',
}) {
  const meta = getBlockMeta(block.type);
  const items = block.categoryIds
    .map((id) => categoriesById.get(id))
    .filter(Boolean);

  if (!items.length) {
    return <div className="myshop-block-empty">Добавьте категории в блок</div>;
  }

  return (
    <>
      <div className={`myshop-block-grid myshop-block-${meta.layout}`}>
        {items.map((category) => (
          <CategoryTile
            key={category.id}
            category={category}
            imageUrl={categoryImages.get(category.id)}
            photoOutside={settings.photoOutside}
            onClick={onCategoryClick}
            active={activeCategoryId === category.id}
          />
        ))}
      </div>
      {publicMode && !activeCategoryId && items.map((category) => {
        const categoryProducts = (productsByCategory.get(category.id) || []).slice(0, 4);
        if (!categoryProducts.length) return null;
        return (
          <div key={`products-${category.id}`} className="myshop-public-category-section">
            <div className="myshop-block-section-head">
              <h3>{category.name}</h3>
              <button type="button" className="myshop-link-btn" onClick={() => onCategoryClick?.(category.id)}>
                Все →
              </button>
            </div>
            <ProductGrid
              products={categoryProducts}
              onProductOpen={onProductOpen}
              publicMode
            />
          </div>
        );
      })}
    </>
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
                  <ShopProductCard
                    key={product.id}
                    product={product}
                    onOpen={onProductOpen}
                    publicMode
                  />
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
  publicMode = false,
  activeCategoryId = '',
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
          publicMode={publicMode}
          productsByCategory={productsByCategory}
          onProductOpen={onProductOpen}
          activeCategoryId={activeCategoryId}
        />
      )}
      {!isSlider && meta.max != null && !publicMode && (
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
  onCategoryClear,
  onProductOpen,
  preview = false,
  publicMode = false,
  branchPhone = '',
  activeNav = 'menu',
  cartCount = 0,
  onNavChange,
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
      if (activeCategoryId && !productMatchesCategory(product, activeCategoryId)) return false;
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

  const branchCategories = useMemo(() => (
    categories.filter((category) => products.some((product) => productMatchesCategory(product, category.id)))
  ), [categories, products]);

  const pageClass = [
    'myshop-page',
    preview ? 'myshop-page-preview' : '',
    publicMode ? 'myshop-page-public' : '',
    settings.hideBackground ? 'myshop-page-hide-bg' : '',
    settings.transparentBackground ? 'myshop-page-transparent' : '',
  ].filter(Boolean).join(' ');

  const activeCategory = activeCategoryId ? categoriesById.get(activeCategoryId) : null;
  const showCategoryView = publicMode && activeCategoryId;

  const handleCategoryChip = (categoryId) => {
    if (!onCategoryClick) return;
    if (activeCategoryId === categoryId) {
      onCategoryClear?.();
    } else {
      onCategoryClick(categoryId);
    }
  };

  return (
    <div className={pageClass}>
      <header className="myshop-header">
        <div className="myshop-brand">
          <span className="myshop-brand-mark" aria-hidden><IconNavShop /></span>
          <div>
            <strong>{publicMode ? branchName : 'MyShop'}</strong>
            <span>{publicMode ? (branchPhone || 'Онлайн-магазин') : branchName}</span>
          </div>
        </div>
        {publicMode && (
          <button
            type="button"
            className="public-shop-header-cart"
            onClick={() => onNavChange?.('cart')}
            aria-label="Корзина"
          >
            <span className="public-shop-header-cart-icon" aria-hidden>🛒</span>
            {cartCount > 0 && <span className="public-shop-header-cart-count">{cartCount}</span>}
          </button>
        )}
      </header>

      {settings.showcase !== false && !showCategoryView && (
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

      {publicMode && branchCategories.length > 0 && !showCategoryView && (
        <div className="myshop-categories">
          <button
            type="button"
            className={`myshop-category-chip${!activeCategoryId ? ' active' : ''}`}
            onClick={() => onCategoryClear?.()}
          >
            Все
          </button>
          {branchCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`myshop-category-chip${activeCategoryId === category.id ? ' active' : ''}`}
              onClick={() => handleCategoryChip(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      {publicMode && !showCategoryView && !activeCategoryId && filteredProducts.length > 0 && (
        <section className="myshop-public-catalog myshop-public-catalog-primary">
          <div className="myshop-block-section-head">
            <h3>{search.trim() ? 'Результаты поиска' : 'Каталог'}</h3>
            <span className="myshop-public-catalog-count">{filteredProducts.length}</span>
          </div>
          <ProductGrid
            products={filteredProducts}
            onProductOpen={onProductOpen}
            publicMode
          />
        </section>
      )}

      {showCategoryView ? (
        <CategoryCatalogView
          category={activeCategory}
          products={filteredProducts}
          search={search}
          onBack={() => onCategoryClear?.()}
          onProductOpen={onProductOpen}
          publicMode
        />
      ) : hasBlocks ? (
        <div className="myshop-blocks">
          {publicMode && !activeCategoryId && (
            <div className="myshop-public-blocks-label">Категории</div>
          )}
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
              publicMode={publicMode}
              activeCategoryId={activeCategoryId}
            />
          ))}
          {publicMode && activeCategoryId && filteredProducts.length > 0 && (
            <section className="myshop-public-catalog">
              <div className="myshop-block-section-head">
                <h3>Товары категории</h3>
                <span className="myshop-public-catalog-count">{filteredProducts.length}</span>
              </div>
              <ProductGrid
                products={filteredProducts}
                onProductOpen={onProductOpen}
                publicMode
              />
            </section>
          )}
        </div>
      ) : preview ? (
        <div className="myshop-preview-placeholder">
          <div className="myshop-preview-skeleton-grid">
            <span /><span /><span /><span /><span />
          </div>
          <p>Добавьте блоки витрины справа</p>
        </div>
      ) : (
        <div className="myshop-fallback-grid">
          {filteredProducts.length === 0 ? (
            <div className="myshop-empty">Нет товаров в этом филиале</div>
          ) : (
            <ProductGrid
              products={filteredProducts}
              onProductOpen={onProductOpen}
              publicMode={publicMode}
            />
          )}
        </div>
      )}

      {settings.menu !== false && (
        <nav className={`myshop-bottom-nav${publicMode ? ' myshop-bottom-nav-public' : ''}`} aria-label="Меню магазина">
          <button
            type="button"
            className={`myshop-bottom-nav-item${activeNav === 'menu' ? ' active' : ''}`}
            onClick={() => (publicMode ? onNavChange?.('menu') : undefined)}
          >
            Меню
          </button>
          {!publicMode && (
            <button type="button" className="myshop-bottom-nav-item">Избранные</button>
          )}
          <button
            type="button"
            className={`myshop-bottom-nav-item${activeNav === 'cart' ? ' active' : ''}${publicMode && cartCount > 0 ? ' has-badge' : ''}`}
            onClick={() => (publicMode ? onNavChange?.('cart') : undefined)}
          >
            Корзина{publicMode && cartCount > 0 ? ` (${cartCount})` : ''}
          </button>
        </nav>
      )}
    </div>
  );
}
