import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, formatMoney } from '../api';
import ShopStorefront from '../components/myshop/ShopStorefront';
import CartSwipeItem from '../components/myshop/CartSwipeItem';
import { IconNavShop, IconNavCart } from '../components/NavIcons';
import {
  addCartItem,
  cartCount,
  cartTotal,
  clearCart,
  getCartItems,
  removeCartItem,
  updateCartItemQty,
} from '../utils/publicShopCart';

function CartView({ items, onBack, onCheckout, onClear, onQtyChange, onRemove, submitting }) {
  const total = cartTotal(items);

  const handleClear = () => {
    if (items.length === 0) return;
    if (confirm('Очистить корзину?')) onClear?.();
  };

  return (
    <div className="public-shop-view">
      <header className="public-shop-subheader">
        <button type="button" className="myshop-link-btn" onClick={onBack}>← Меню</button>
        <h2>Корзина</h2>
        {items.length > 0 && (
          <button type="button" className="public-shop-clear-btn" onClick={handleClear}>
            Очистить
          </button>
        )}
      </header>

      {items.length === 0 ? (
        <div className="public-shop-cart-empty">
          <div className="myshop-empty">Корзина пуста</div>
          <button type="button" className="btn btn-primary" onClick={onBack}>К каталогу</button>
        </div>
      ) : (
        <>
          <ul className="public-shop-cart-list">
            {items.map((item) => (
              <CartSwipeItem
                key={`${item.product_id}:${item.variant_id || ''}`}
                item={item}
                onRemove={onRemove}
                onQtyChange={onQtyChange}
              />
            ))}
          </ul>
          <div className="public-shop-cart-footer">
            <div className="public-shop-cart-total">
              <span>Итого</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            <button
              type="button"
              className="btn btn-primary public-shop-checkout-btn"
              onClick={onCheckout}
              disabled={submitting}
            >
              {submitting ? 'Отправка...' : 'Оформить заказ'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function PublicShop() {
  const { branchId } = useParams();
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('menu');
  const [search, setSearch] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState('');
  const [cartItems, setCartItems] = useState(() => getCartItems(branchId));
  const [submitting, setSubmitting] = useState(false);
  const [orderNotice, setOrderNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getPublicShopCatalog(branchId);
      setCatalog(data);
    } catch (err) {
      setCatalog(null);
      setError(err.message || 'Магазин недоступен');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setCartItems(getCartItems(branchId)); }, [branchId]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    html.classList.add('public-shop-lock');
    body.classList.add('public-shop-lock');
    root?.classList.add('public-shop-lock');

    const viewport = document.querySelector('meta[name="viewport"]');
    const prevViewport = viewport?.getAttribute('content') || '';
    viewport?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
    );

    return () => {
      html.classList.remove('public-shop-lock');
      body.classList.remove('public-shop-lock');
      root?.classList.remove('public-shop-lock');
      if (viewport && prevViewport) viewport.setAttribute('content', prevViewport);
    };
  }, []);

  useEffect(() => {
    const prevTitle = document.title;
    if (catalog?.branch?.name) {
      document.title = `${catalog.branch.name} — магазин`;
    }
    return () => {
      document.title = prevTitle;
    };
  }, [catalog?.branch?.name]);

  useEffect(() => {
    if (!orderNotice) return undefined;
    const timer = window.setTimeout(() => setOrderNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [orderNotice]);

  const handleProductAdd = (product, quantity = 1) => {
    const next = addCartItem(branchId, {
      product_id: product.id,
      variant_id: product.variant_id || null,
      product_name: product.name,
      variant_name: null,
      quantity,
      price: product.price ?? 0,
      unit: product.unit || 'шт',
    });
    setCartItems(next);
  };

  const handleProductQtyChange = (product, quantity) => {
    const next = updateCartItemQty(branchId, product.id, product.variant_id || null, quantity);
    setCartItems(next);
  };

  const handleQtyChange = (productId, variantId, quantity) => {
    const next = updateCartItemQty(branchId, productId, variantId, quantity);
    setCartItems(next);
  };

  const handleRemove = (productId, variantId) => {
    const next = removeCartItem(branchId, productId, variantId);
    setCartItems(next);
  };

  const handleClearCart = () => {
    clearCart(branchId);
    setCartItems([]);
  };

  const handlePlaceOrder = async () => {
    if (cartItems.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const order = await api.createPublicShopOrder(branchId, {
        customer_name: 'Гость',
        customer_phone: '',
        delivery_type: 'pickup',
        items: cartItems.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.quantity,
        })),
      });
      clearCart(branchId);
      setCartItems([]);
      setOrderNotice(`Заказ №${order.number} принят и отправлен в заявки`);
      setView('menu');
    } catch (err) {
      alert(err.message || 'Не удалось оформить заказ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCategorySelect = (id) => {
    setActiveCategoryId(id);
  };

  const handleCategoryClear = () => {
    setActiveCategoryId('');
  };

  const handleNav = (tab) => {
    if (tab === 'menu') {
      setView('menu');
    } else if (tab === 'cart') {
      setView('cart');
    }
  };

  const count = cartCount(cartItems);

  if (loading) {
    return (
      <div className="public-shop-shell public-shop-snappy">
        <div className="myshop-page"><div className="myshop-empty">Загрузка...</div></div>
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div className="public-shop-shell public-shop-snappy">
        <div className="myshop-page">
          <div className="myshop-empty">{error || 'Магазин недоступен'}</div>
        </div>
      </div>
    );
  }

  const { branch, layout, products, categories } = catalog;

  if (products.length === 0) {
    return (
      <div className="public-shop-shell public-shop-snappy">
        <div className="myshop-page myshop-page-public">
          <header className="myshop-header">
            <div className="myshop-brand">
              <span className="myshop-brand-mark" aria-hidden>🛒</span>
              <div>
                <strong>{branch.name}</strong>
                <span>Онлайн-магазин</span>
              </div>
            </div>
          </header>
          <div className="myshop-empty public-shop-empty-catalog">
            <p>В этом филиале пока нет товаров для витрины.</p>
            <p className="public-shop-empty-hint">
              В справочнике «Товары» включите отображение для филиала «{branch.name}» на вкладке «Филиалы».
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="public-shop-shell public-shop-snappy">
      {orderNotice && (
        <div className="public-shop-order-notice" role="status">
          <span>{orderNotice}</span>
          <button type="button" onClick={() => setOrderNotice('')} aria-label="Закрыть">×</button>
        </div>
      )}

      {view === 'menu' && (
        <ShopStorefront
          layout={layout}
          categories={categories}
          products={products}
          branchName={branch.name}
          branchPhone={branch.phone}
          search={search}
          onSearchChange={setSearch}
          activeCategoryId={activeCategoryId}
          onCategoryClick={handleCategorySelect}
          onCategoryClear={handleCategoryClear}
          onProductAdd={handleProductAdd}
          onProductQtyChange={handleProductQtyChange}
          cartItems={cartItems}
          publicMode
          activeNav="menu"
          cartCount={count}
          onNavChange={handleNav}
        />
      )}

      {view === 'cart' && (
        <div className="myshop-page myshop-page-public public-shop-page">
          <CartView
            items={cartItems}
            onBack={() => setView('menu')}
            onCheckout={handlePlaceOrder}
            onClear={handleClearCart}
            onQtyChange={handleQtyChange}
            onRemove={handleRemove}
            submitting={submitting}
          />
          {layout?.settings?.menu !== false && (
            <nav className="myshop-bottom-nav myshop-bottom-nav-public myshop-bottom-nav-icons" aria-label="Меню магазина">
              <button type="button" className="myshop-bottom-nav-item" onClick={() => handleNav('menu')} aria-label="Меню" title="Меню">
                <IconNavShop />
              </button>
              <button
                type="button"
                className={`myshop-bottom-nav-item active${count > 0 ? ' has-badge' : ''}`}
                onClick={() => handleNav('cart')}
                aria-label={count > 0 ? `Корзина, ${count}` : 'Корзина'}
                title={count > 0 ? `Корзина (${count})` : 'Корзина'}
              >
                <IconNavCart />
                {count > 0 && <span className="myshop-bottom-nav-badge">{count}</span>}
              </button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
