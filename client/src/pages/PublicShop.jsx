import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { formatUzPhone } from '../phoneFormat';
import ShopStorefront from '../components/myshop/ShopStorefront';
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

function CartView({ items, onBack, onCheckout, onQtyChange, onRemove }) {
  const total = cartTotal(items);

  return (
    <div className="public-shop-view">
      <header className="public-shop-subheader">
        <button type="button" className="myshop-link-btn" onClick={onBack}>← Меню</button>
        <h2>Корзина</h2>
      </header>

      {items.length === 0 ? (
        <div className="myshop-empty">Корзина пуста</div>
      ) : (
        <>
          <ul className="public-shop-cart-list">
            {items.map((item) => {
              const label = item.variant_name
                ? `${item.product_name} — ${item.variant_name}`
                : item.product_name;
              return (
                <li key={`${item.product_id}:${item.variant_id || ''}`} className="public-shop-cart-item">
                  <div className="public-shop-cart-item-main">
                    <strong>{label}</strong>
                    <span>{formatMoney(item.price)} × {item.quantity} {item.unit || 'шт'}</span>
                    <strong>{formatMoney(item.price * item.quantity)}</strong>
                  </div>
                  <div className="public-shop-cart-item-actions">
                    <div className="myshop-qty-controls myshop-qty-controls-sm">
                      <button
                        type="button"
                        onClick={() => onQtyChange(item.product_id, item.variant_id, item.quantity - 1)}
                        aria-label="Меньше"
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => onQtyChange(item.product_id, item.variant_id, item.quantity + 1)}
                        aria-label="Больше"
                      >
                        +
                      </button>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(item.product_id, item.variant_id)}>
                      Удалить
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="public-shop-cart-footer">
            <div className="public-shop-cart-total">
              <span>Итого</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            <button type="button" className="btn btn-primary public-shop-checkout-btn" onClick={onCheckout}>
              Оформить заказ
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CheckoutView({ branch, items, onBack, onSubmit, submitting, error }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [deliveryType, setDeliveryType] = useState('pickup');
  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');
  const total = cartTotal(items);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      customer_name: name.trim(),
      customer_phone: phone.replace(/\D/g, ''),
      delivery_type: deliveryType,
      address: deliveryType === 'delivery' ? address.trim() : '',
      comment: comment.trim(),
      items: items.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity,
      })),
    });
  };

  return (
    <div className="public-shop-view">
      <header className="public-shop-subheader">
        <button type="button" className="myshop-link-btn" onClick={onBack}>← Корзина</button>
        <h2>Оформление</h2>
      </header>

      <form className="public-shop-checkout-form" onSubmit={handleSubmit}>
        <label className="myshop-field">
          <span>Имя</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ваше имя" />
        </label>
        <label className="myshop-field">
          <span>Телефон</span>
          <input
            value={phone}
            onChange={(e) => setPhone(formatUzPhone(e.target.value))}
            required
            placeholder="+998-90-123-45-67"
            inputMode="tel"
          />
        </label>

        <fieldset className="public-shop-delivery-type">
          <legend>Способ получения</legend>
          <label>
            <input
              type="radio"
              name="delivery"
              checked={deliveryType === 'pickup'}
              onChange={() => setDeliveryType('pickup')}
            />
            Самовывоз{branch?.address ? ` · ${branch.address}` : ''}
          </label>
          <label>
            <input
              type="radio"
              name="delivery"
              checked={deliveryType === 'delivery'}
              onChange={() => setDeliveryType('delivery')}
            />
            Доставка
          </label>
        </fieldset>

        {deliveryType === 'delivery' && (
          <label className="myshop-field">
            <span>Адрес доставки</span>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              rows={3}
              placeholder="Улица, дом, подъезд"
            />
          </label>
        )}

        <label className="myshop-field">
          <span>Комментарий</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Пожелания к заказу"
          />
        </label>

        <div className="public-shop-cart-total">
          <span>К оплате</span>
          <strong>{formatMoney(total)}</strong>
        </div>

        {error && <div className="form-error">{error}</div>}

        <button type="submit" className="btn btn-primary public-shop-checkout-btn" disabled={submitting || items.length === 0}>
          {submitting ? 'Отправка...' : 'Подтвердить заказ'}
        </button>
      </form>
    </div>
  );
}

function SuccessView({ order, branch, onMenu }) {
  return (
    <div className="public-shop-view public-shop-success">
      <div className="public-shop-success-card">
        <div className="public-shop-success-icon" aria-hidden>✓</div>
        <h2>Заказ принят</h2>
        <p>Номер заказа: <strong>№{order.number}</strong></p>
        <p>{branch?.name}</p>
        <p className="public-shop-success-sum">{formatMoney(order.total_amount)}</p>
        <p className="public-shop-success-note">Мы свяжемся с вами по телефону для подтверждения.</p>
        <button type="button" className="btn btn-primary" onClick={onMenu}>Вернуться в меню</button>
      </div>
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
  const [submitError, setSubmitError] = useState('');
  const [completedOrder, setCompletedOrder] = useState(null);

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
    const prevTitle = document.title;
    if (catalog?.branch?.name) {
      document.title = `${catalog.branch.name} — магазин`;
    }
    return () => {
      document.title = prevTitle;
    };
  }, [catalog?.branch?.name]);

  const handleProductAdd = (product) => {
    if ((product.stock || 0) <= 0) return;
    const next = addCartItem(branchId, {
      product_id: product.id,
      variant_id: product.variant_id || null,
      product_name: product.name,
      variant_name: null,
      quantity: 1,
      price: product.price ?? 0,
      unit: product.unit || 'шт',
    });
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

  const handleCheckoutSubmit = async (payload) => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const order = await api.createPublicShopOrder(branchId, payload);
      clearCart(branchId);
      setCartItems([]);
      setCompletedOrder(order);
      setView('success');
    } catch (err) {
      setSubmitError(err.message || 'Не удалось оформить заказ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCategorySelect = (id) => {
    setActiveCategoryId(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCategoryClear = () => {
    setActiveCategoryId('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNav = (tab) => {
    if (tab === 'menu') {
      setView('menu');
      setCompletedOrder(null);
    } else if (tab === 'cart') {
      setView('cart');
    }
  };

  const count = cartCount(cartItems);

  if (loading) {
    return (
      <div className="public-shop-shell">
        <div className="myshop-page"><div className="myshop-empty">Загрузка...</div></div>
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div className="public-shop-shell">
        <div className="myshop-page">
          <div className="myshop-empty">{error || 'Магазин недоступен'}</div>
        </div>
      </div>
    );
  }

  const { branch, layout, products, categories } = catalog;

  if (products.length === 0) {
    return (
      <div className="public-shop-shell">
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
    <div className="public-shop-shell">
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
          publicMode
          activeNav="menu"
          cartCount={count}
          onNavChange={handleNav}
        />
      )}

      {view === 'cart' && (
        <div className="myshop-page public-shop-page">
          <CartView
            items={cartItems}
            onBack={() => setView('menu')}
            onCheckout={() => setView('checkout')}
            onQtyChange={handleQtyChange}
            onRemove={handleRemove}
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

      {view === 'checkout' && (
        <div className="myshop-page public-shop-page">
          <CheckoutView
            branch={branch}
            items={cartItems}
            onBack={() => setView('cart')}
            onSubmit={handleCheckoutSubmit}
            submitting={submitting}
            error={submitError}
          />
        </div>
      )}

      {view === 'success' && completedOrder && (
        <div className="myshop-page public-shop-page">
          <SuccessView
            order={completedOrder}
            branch={branch}
            onMenu={() => {
              setCompletedOrder(null);
              setView('menu');
            }}
          />
        </div>
      )}

    </div>
  );
}
