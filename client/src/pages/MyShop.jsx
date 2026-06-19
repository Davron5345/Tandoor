import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatMoney } from '../api';
import { useBranch } from '../BranchContext';
import { IconImage } from '../components/ActionIcons';
import { IconNavShop } from '../components/NavIcons';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

function formatShopPrice(product) {
  if (product.has_variants && product.variant_price_min != null) {
    if (product.variant_price_max != null && product.variant_price_min !== product.variant_price_max) {
      return `от ${formatMoney(product.variant_price_min)}`;
    }
    return formatMoney(product.variant_price_min);
  }
  return formatMoney(product.price);
}

function getVariantImage(variant) {
  if (!variant?.images?.length) return null;
  return variant.images.find((i) => i.is_primary && i.media_type === 'photo')
    || variant.images.find((i) => i.media_type === 'photo')
    || variant.images[0];
}

function ShopMedia({ image, name }) {
  if (!image) {
    return (
      <div className="myshop-media myshop-media-empty" aria-hidden>
        <IconImage />
      </div>
    );
  }

  return (
    <div className="myshop-media">
      <img src={image.url} alt={name} loading="lazy" />
      {image.media_type === 'gif' && <span className="myshop-media-badge">GIF</span>}
    </div>
  );
}

function ShopProductCard({ product, onOpen }) {
  return (
    <button type="button" className="myshop-card" onClick={() => onOpen(product)}>
      <ShopMedia image={product.primary_image} name={product.name} />
      <div className="myshop-card-body">
        <div className="myshop-card-name">{product.name}</div>
        <div className="myshop-card-price">{formatShopPrice(product)}</div>
        {product.unit && <div className="myshop-card-meta">{product.unit}</div>}
      </div>
    </button>
  );
}

function ShopProductSheet({ product, onClose }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!product) return null;

  const variants = product.variants || [];

  return (
    <div className="myshop-sheet-overlay" onClick={onClose}>
      <div className="myshop-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="myshop-sheet-handle" aria-hidden />
        <button type="button" className="myshop-sheet-close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
        <ShopMedia image={product.primary_image} name={product.name} />
        <div className="myshop-sheet-body">
          <h2 className="myshop-sheet-title">{product.name}</h2>
          {product.category_name && (
            <div className="myshop-sheet-category">{product.category_name}</div>
          )}
          <div className="myshop-sheet-price">{formatShopPrice(product)}</div>
          {product.unit && (
            <div className="myshop-sheet-meta">Единица: {product.unit}</div>
          )}
          {product.stock != null && (
            <div className="myshop-sheet-meta">
              В наличии: {Number(product.stock).toLocaleString('ru-RU')} {product.unit || 'шт.'}
            </div>
          )}
          {variants.length > 0 && (
            <div className="myshop-variants">
              <div className="myshop-variants-title">Варианты</div>
              <div className="myshop-variants-list">
                {variants.map((variant) => {
                  const image = getVariantImage(variant);
                  return (
                    <div key={variant.id} className="myshop-variant-row">
                      <ShopMedia image={image} name={variant.name} />
                      <div className="myshop-variant-info">
                        <div className="myshop-variant-name">{variant.name}</div>
                        <div className="myshop-variant-price">{formatMoney(variant.price)}</div>
                        <div className="myshop-variant-meta">
                          {Number(variant.stock || 0).toLocaleString('ru-RU')} {product.unit || 'шт.'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyShop() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const { branchId, branchName } = useBranch();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const productList = await api.getProducts();
      setProducts(productList);
    } catch (err) {
      console.error(err);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(load, [load, branchId]);

  const categories = useMemo(() => {
    const map = new Map();
    for (const product of products) {
      if (product.category_id && product.category_name) {
        map.set(product.category_id, product.category_name);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId && product.category_id !== categoryId) return false;
      if (!q) return true;
      const haystack = [
        product.name,
        product.category_name,
        product.parent_category_name,
        product.sku,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [products, search, categoryId]);

  return (
    <div className="myshop-page">
      <header className="myshop-header">
        <div className="myshop-brand">
          <span className="myshop-brand-mark" aria-hidden><IconNavShop /></span>
          <div>
            <strong>MyShop</strong>
            <span>{branchName}</span>
          </div>
        </div>
      </header>

      <div className="myshop-search-wrap">
        <input
          type="search"
          className="myshop-search"
          placeholder="Поиск товаров"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {categories.length > 0 && (
        <div className="myshop-categories" role="tablist" aria-label="Категории">
          <button
            type="button"
            className={`myshop-category-chip${categoryId === '' ? ' active' : ''}`}
            onClick={() => setCategoryId('')}
          >
            Все
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`myshop-category-chip${categoryId === category.id ? ' active' : ''}`}
              onClick={() => setCategoryId(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="myshop-empty">Загрузка...</div>
      ) : filteredProducts.length === 0 ? (
        <div className="myshop-empty">
          {products.length === 0 ? 'Нет товаров для этого филиала' : 'Ничего не найдено'}
        </div>
      ) : (
        <div className="myshop-grid">
          {filteredProducts.map((product) => (
            <ShopProductCard
              key={product.id}
              product={product}
              onOpen={setSelectedProduct}
            />
          ))}
        </div>
      )}

      {selectedProduct && (
        <ShopProductSheet
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  );
}
