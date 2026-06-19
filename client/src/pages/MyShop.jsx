import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { hasPermission } from '../permissions';
import ShopStorefront, { formatShopPrice, ShopMedia } from '../components/myshop/ShopStorefront';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { createEmptyLayout } from '../utils/myShopLayout';
import { useToast } from '../components/Modal';

function getVariantImage(variant) {
  if (!variant?.images?.length) return null;
  return variant.images.find((i) => i.is_primary && i.media_type === 'photo')
    || variant.images.find((i) => i.media_type === 'photo')
    || variant.images[0];
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
  const { user } = useAuth();
  const [layout, setLayout] = useState(createEmptyLayout);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const { branchId, branchName } = useBranch();
  const canEditMyShop = hasPermission(user, 'myshop.edit');
  const canViewShopOrders = hasPermission(user, 'shop_orders.view');
  const { show, Toast } = useToast();
  const publicShopUrl = branchId ? `${window.location.origin}/shop/${branchId}` : '';

  const copyPublicLink = async () => {
    if (!publicShopUrl) return;
    try {
      await navigator.clipboard.writeText(publicShopUrl);
      show('Ссылка скопирована');
    } catch {
      show('Не удалось скопировать ссылку', 'error');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [layoutData, productList, categoryList] = await Promise.all([
        api.getMyShopLayout(),
        api.getProducts(),
        api.getProductCategories(),
      ]);
      setLayout(layoutData);
      setProducts(productList);
      setCategories(categoryList);
    } catch (err) {
      console.error(err);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(load, [load, branchId]);

  if (loading) {
    return <div className="myshop-page"><div className="myshop-empty">Загрузка...</div></div>;
  }

  return (
    <>
      {Toast}
      {canEditMyShop && (
        <div className="myshop-admin-bar">
          <Link to="/myshop/constructor" className="btn btn-ghost btn-sm">Конструктор</Link>
          {canViewShopOrders && (
            <Link to="/shop-orders" className="btn btn-ghost btn-sm">Заказы</Link>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyPublicLink}>
            Ссылка для клиентов
          </button>
        </div>
      )}
      <ShopStorefront
        layout={layout}
        categories={categories}
        products={products}
        branchName={branchName}
        search={search}
        onSearchChange={setSearch}
        activeCategoryId={activeCategoryId}
        onCategoryClick={setActiveCategoryId}
        onProductOpen={setSelectedProduct}
      />
      {selectedProduct && (
        <ShopProductSheet
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </>
  );
}
