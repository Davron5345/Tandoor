import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney } from '../../api';
import { IconImage } from '../ActionIcons';
import { IconNavShop, IconNavCart } from '../NavIcons';
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
      const productKey = product.catalog_key || product.id;
      if (!map.get(categoryId).some((p) => (p.catalog_key || p.id) === productKey)) {
        map.get(categoryId).push(product);
      }
    }
  }
  return map;
}

function getCategoriesWithDirectProducts(categories, products) {
  const parentIds = new Set(
    categories.filter((category) => category.parent_id).map((category) => category.parent_id),
  );
  const directProductCategoryIds = new Set(
    products.map((product) => product.category_id).filter(Boolean),
  );

  return categories
    .filter((category) => directProductCategoryIds.has(category.id) && !parentIds.has(category.id))
    .sort((a, b) => {
      const aParent = categories.find((c) => c.id === a.parent_id);
      const bParent = categories.find((c) => c.id === b.parent_id);
      const aSort = aParent?.sort_order ?? a.sort_order ?? 999;
      const bSort = bParent?.sort_order ?? b.sort_order ?? 999;
      if (aSort !== bSort) return aSort - bSort;
      const aParentName = aParent?.name || '';
      const bParentName = bParent?.name || '';
      if (aParentName !== bParentName) return aParentName.localeCompare(bParentName, 'ru');
      return a.name.localeCompare(b.name, 'ru');
    });
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

function ShopProductCard({ product, onOpen, onAdd, publicMode = false }) {
  const inStock = (product.stock || 0) > 0;

  const handleActivate = () => {
    if (publicMode) {
      if (!inStock || !onAdd) return;
      onAdd(product);
      return;
    }
    onOpen?.(product);
  };

  return (
    <article className={`myshop-product-card${!inStock ? ' is-out-of-stock' : ''}${publicMode ? ' is-clickable' : ''}`}>
      <button
        type="button"
        className="myshop-product-card-media-btn"
        onClick={handleActivate}
        aria-label={product.name}
        disabled={publicMode && !inStock}
      >
        <ShopMedia image={product.primary_image} name={product.name} />
        {!inStock && <span className="myshop-product-badge">Нет в наличии</span>}
      </button>
      <div className="myshop-product-card-body">
        <button
          type="button"
          className="myshop-product-card-name"
          onClick={handleActivate}
          disabled={publicMode && !inStock}
        >
          {product.name}
        </button>
        <div className="myshop-product-card-footer">
          <span className="myshop-product-card-price">{formatShopPrice(product)}</span>
          {!publicMode && inStock && (
            <button
              type="button"
              className="myshop-product-add-btn"
              onClick={() => onOpen?.(product)}
              aria-label={`Открыть ${product.name}`}
            >
              +
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function ProductGrid({ products, onProductOpen, onProductAdd, publicMode = false, emptyText = 'Нет товаров' }) {
  if (!products.length) {
    return <div className="myshop-empty">{emptyText}</div>;
  }

  return (
    <div className="myshop-grid">
      {products.map((product) => (
        <ShopProductCard
          key={product.catalog_key || `${product.id}:${product.variant_id || ''}`}
          product={product}
          onOpen={onProductOpen}
          onAdd={onProductAdd}
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
  onProductAdd,
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
        onProductAdd={onProductAdd}
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
  onProductAdd,
  activeCategoryId = '',
  catalogBrowseMode = false,
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
    </>
  );
}

function PublicCategoryCatalog({
  categories,
  productsByCategory,
  onProductOpen,
  onProductAdd,
}) {
  return (
    <div className="myshop-public-category-catalog">
      {categories.map((category) => {
        const categoryProducts = productsByCategory.get(category.id) || [];
        if (!categoryProducts.length) return null;
        return (
          <section
            key={category.id}
            className="myshop-public-category-section"
            data-category-section={category.id}
          >
            <div className="myshop-block-section-head">
              <h3>{category.name}</h3>
              <span className="myshop-public-catalog-count">{categoryProducts.length}</span>
            </div>
            <ProductGrid
              products={categoryProducts}
              onProductOpen={onProductOpen}
              onProductAdd={onProductAdd}
              publicMode
            />
          </section>
        );
      })}
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
  onProductAdd,
  onCategoryClick,
  catalogBrowseMode = false,
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
            {products.length > 0 && !catalogBrowseMode && (
              <div className="myshop-grid myshop-grid-compact">
                {products.map((product) => (
                  <ShopProductCard
                    key={product.catalog_key || `${product.id}:${product.variant_id || ''}`}
                    product={product}
                    onOpen={onProductOpen}
                    onAdd={onProductAdd}
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
  onProductAdd,
  onCategoryClick,
  publicMode = false,
  activeCategoryId = '',
  catalogBrowseMode = false,
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
          onProductAdd={onProductAdd}
          onCategoryClick={onCategoryClick}
          catalogBrowseMode={catalogBrowseMode}
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
          onProductAdd={onProductAdd}
          activeCategoryId={activeCategoryId}
          catalogBrowseMode={catalogBrowseMode}
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
  onProductAdd,
  preview = false,
  publicMode = false,
  branchPhone = '',
  activeNav = 'menu',
  cartCount = 0,
  onNavChange,
}) {
  const scrollBodyRef = useRef(null);
  const chipBarRef = useRef(null);
  const scrollSpyFrameRef = useRef(null);
  const [highlightedCategoryId, setHighlightedCategoryId] = useState('');

  const settings = layout?.settings || {};
  const blocks = layout?.blocks || [];
  const hasBlocks = blocks.length > 0;

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryImages = useMemo(() => buildCategoryImageMap(products), [products]);
  const productsByCategory = useMemo(() => buildCategoryProductMap(products), [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((product) => {
      if (activeCategoryId) {
        const inCategory = product.category_id === activeCategoryId
          || product.category_parent_id === activeCategoryId;
        if (!inCategory) return false;
      }
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

  const branchCategories = useMemo(
    () => getCategoriesWithDirectProducts(categories, products),
    [categories, products],
  );

  const pageClass = [
    'myshop-page',
    preview ? 'myshop-page-preview' : '',
    publicMode ? 'myshop-page-public' : '',
    settings.hideBackground ? 'myshop-page-hide-bg' : '',
    settings.transparentBackground ? 'myshop-page-transparent' : '',
  ].filter(Boolean).join(' ');

  const activeCategory = activeCategoryId ? categoriesById.get(activeCategoryId) : null;
  const showCategoryView = publicMode && activeCategoryId;
  const scrollSpyEnabled = publicMode && !showCategoryView && !search.trim() && !activeCategoryId;
  const chipActiveId = activeCategoryId || highlightedCategoryId;

  useEffect(() => {
    if (!publicMode) return;
    scrollBodyRef.current?.scrollTo({ top: 0 });
    setHighlightedCategoryId('');
  }, [publicMode, activeCategoryId, search]);

  const updateScrollSpy = useCallback(() => {
    const root = scrollBodyRef.current;
    if (!root || !scrollSpyEnabled) return;

    const scrollTop = root.scrollTop;
    const offset = 16;
    let current = '';

    for (const category of branchCategories) {
      const section = root.querySelector(`[data-category-section="${category.id}"]`);
      if (!section) continue;
      if (section.offsetTop - offset <= scrollTop) {
        current = category.id;
      }
    }

    setHighlightedCategoryId((prev) => (prev === current ? prev : current));
  }, [branchCategories, scrollSpyEnabled]);

  useEffect(() => {
    if (!scrollSpyEnabled) {
      setHighlightedCategoryId('');
      return undefined;
    }

    const root = scrollBodyRef.current;
    if (!root) return undefined;

    const onScroll = () => {
      if (scrollSpyFrameRef.current) cancelAnimationFrame(scrollSpyFrameRef.current);
      scrollSpyFrameRef.current = requestAnimationFrame(updateScrollSpy);
    };

    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (scrollSpyFrameRef.current) cancelAnimationFrame(scrollSpyFrameRef.current);
    };
  }, [scrollSpyEnabled, updateScrollSpy, branchCategories, products]);

  useEffect(() => {
    if (!scrollSpyEnabled || !highlightedCategoryId) return;
    const chip = chipBarRef.current?.querySelector(`[data-category-chip="${highlightedCategoryId}"]`);
    chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [highlightedCategoryId, scrollSpyEnabled]);

  const scrollToCategorySection = (categoryId) => {
    const root = scrollBodyRef.current;
    if (!root) return;
    if (!categoryId) {
      root.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const section = root.querySelector(`[data-category-section="${categoryId}"]`);
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCategoryChip = (categoryId) => {
    if (activeCategoryId) {
      if (activeCategoryId === categoryId) onCategoryClear?.();
      else onCategoryClick?.(categoryId);
      return;
    }
    scrollToCategorySection(categoryId);
  };

  const handleAllChip = () => {
    if (activeCategoryId) {
      onCategoryClear?.();
      return;
    }
    scrollToCategorySection('');
  };

  const topBar = (
    <>
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
        <div ref={chipBarRef} className="myshop-categories myshop-categories-sticky">
          <button
            type="button"
            className={`myshop-category-chip${!chipActiveId ? ' active' : ''}`}
            data-category-chip=""
            onClick={handleAllChip}
          >
            Все
          </button>
          {branchCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`myshop-category-chip${chipActiveId === category.id ? ' active' : ''}`}
              data-category-chip={category.id}
              onClick={() => handleCategoryChip(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}
    </>
  );

  const mainContent = (
    <>
      {publicMode && !showCategoryView && !activeCategoryId && search.trim() && filteredProducts.length > 0 && (
        <section className="myshop-public-catalog myshop-public-catalog-primary">
          <div className="myshop-block-section-head">
            <h3>Результаты поиска</h3>
            <span className="myshop-public-catalog-count">{filteredProducts.length}</span>
          </div>
          <ProductGrid
            products={filteredProducts}
            onProductOpen={onProductOpen}
            onProductAdd={onProductAdd}
            publicMode
          />
        </section>
      )}

      {publicMode && !showCategoryView && !activeCategoryId && !search.trim() && branchCategories.length > 0 && (
        <>
          {hasBlocks && (
            <div className="myshop-blocks">
              {publicMode && (
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
                  onProductAdd={onProductAdd}
                  onCategoryClick={scrollSpyEnabled ? scrollToCategorySection : onCategoryClick}
                  publicMode={publicMode}
                  activeCategoryId={activeCategoryId}
                  catalogBrowseMode
                />
              ))}
            </div>
          )}
          <PublicCategoryCatalog
            categories={branchCategories}
            productsByCategory={productsByCategory}
            onProductOpen={onProductOpen}
            onProductAdd={onProductAdd}
          />
        </>
      )}

      {showCategoryView ? (
        <CategoryCatalogView
          category={activeCategory}
          products={filteredProducts}
          search={search}
          onBack={() => onCategoryClear?.()}
          onProductOpen={onProductOpen}
          onProductAdd={onProductAdd}
          publicMode
        />
      ) : hasBlocks && !(publicMode && !activeCategoryId && !search.trim()) ? (
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
              onProductAdd={onProductAdd}
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
                onProductAdd={onProductAdd}
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
              onProductAdd={onProductAdd}
              publicMode={publicMode}
            />
          )}
        </div>
      )}
    </>
  );

  const bottomNav = settings.menu !== false ? (
    <nav
      className={`myshop-bottom-nav${publicMode ? ' myshop-bottom-nav-public myshop-bottom-nav-icons' : ''}`}
      aria-label="Меню магазина"
    >
      <button
        type="button"
        className={`myshop-bottom-nav-item${activeNav === 'menu' ? ' active' : ''}`}
        onClick={() => (publicMode ? onNavChange?.('menu') : undefined)}
        aria-label="Меню"
        title="Меню"
      >
        {publicMode ? <IconNavShop /> : 'Меню'}
      </button>
      {!publicMode && (
        <button type="button" className="myshop-bottom-nav-item">Избранные</button>
      )}
      <button
        type="button"
        className={`myshop-bottom-nav-item${activeNav === 'cart' ? ' active' : ''}${publicMode && cartCount > 0 ? ' has-badge' : ''}`}
        onClick={() => (publicMode ? onNavChange?.('cart') : undefined)}
        aria-label={cartCount > 0 ? `Корзина, ${cartCount}` : 'Корзина'}
        title={cartCount > 0 ? `Корзина (${cartCount})` : 'Корзина'}
      >
        {publicMode ? (
          <>
            <IconNavCart />
            {cartCount > 0 && <span className="myshop-bottom-nav-badge">{cartCount}</span>}
          </>
        ) : (
          `Корзина${publicMode && cartCount > 0 ? ` (${cartCount})` : ''}`
        )}
      </button>
    </nav>
  ) : null;

  if (publicMode) {
    return (
      <div className={pageClass}>
        <div className="myshop-public-topbar">{topBar}</div>
        <div ref={scrollBodyRef} className="myshop-public-body">{mainContent}</div>
        {bottomNav}
      </div>
    );
  }

  return (
    <div className={pageClass}>
      {topBar}
      {mainContent}
      {bottomNav}
    </div>
  );
}
