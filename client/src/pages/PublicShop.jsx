import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, formatMoney } from '../api';
import { formatUzPhone } from '../phoneFormat';
import ShopStorefront, { ShopMedia } from '../components/myshop/ShopStorefront';
import {
  addCartItem,
  cartCount,
  cartTotal,
  clearCart,
  getCartItems,
  removeCartItem,
  updateCartItemQty,
} from '../utils/publicShopCart';

function getVariantImage(variant) {
  if (!variant?.images?.length) return null;
  return variant.images.find((i) => i.is_primary && i.media_type === 'photo')
    || variant.images.find((i) => i.media_type === 'photo')
    || variant.images[0];
}

function PublicProductSheet({ product, onClose, onAdd }) {
  const variants = product?.variants || [];
  const needsVariant = product?.has_variants && variants.length > 0;
  const [variantId, setVariantId] = useState(variants[0]?.id || null);
  const [qty, setQty] = useState(1);

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

  useEffect(() => {
    setVariantId(variants[0]?.id || null);
    setQty(1);
  }, [product?.id, variants]);

  if (!product) return null;

  const selectedVariant = variants.find((v) => v.id === variantId);
  const price = selectedVariant?.price ?? product.price ?? 0;
  const stock = selectedVariant?.stock ?? product.stock ?? 0;
  const displayImage = selectedVariant ? getVariantImage(selectedVariant) : product.primary_image;
  const canAdd = stock > 0 && (!needsVariant || selectedVariant);

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd({
      product_id: product.id,
      variant_id: selectedVariant?.id || null,
      product_name: product.name,
      variant_name: selectedVariant?.name || null,
      quantity: qty,
      price,
      unit: product.unit || 'шт',
    });
    onClose();
  };

  return (
    <div className="myshop-sheet-overlay" onClick={onClose}>
      <div className="myshop-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="myshop-sheet-handle" aria-hidden />
        <button type="button" className="myshop-sheet-close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
        <ShopMedia image={displayImage || product.primary_image} name={product.name} />
        <div className="myshop-sheet-body">
          <h2 className="myshop-sheet-title">{product.name}</h2>
          {product.category_name && (
            <div className="myshop-sheet-category">{product.category_name}</div>
          )}
          <div className="myshop-sheet-price">{formatMoney(price)}</div>
          {product.unit && (
            <div className="myshop-sheet-meta">Единица: {product.unit}</div>
          )}
          <div className="myshop-sheet-meta">
            {stock > 0
              ? `В наличии: ${Number(stock).toLocaleString('ru-RU')} ${product.unit || 'шт.'}`
              : 'Нет в наличии'}
          </div>

          {needsVariant && (
            <div className="myshop-variants">
              <div className="myshop-variants-title">Выберите вариант</div>
              <div className="myshop-variants-list">
                {variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    className={`myshop-variant-pick${variantId === variant.id ? ' active' : ''}`}
                    onClick={() => setVariantId(variant.id)}
                    disabled={(variant.stock || 0) <= 0}
                  >
                    <span>{variant.name}</span>
                    <span>{formatMoney(variant.price)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="myshop-qty-row">
            <span>Количество</span>
            <div className="myshop-qty-controls">
              <button type="button" onClick={() => setQty((v) => Math.max(1, v - 1))} aria-label="Меньше">−</button>
              <span>{qty}</span>
              <button
                type="button"
                onClick={() => setQty((v) => Math.min(stock || v + 1, v + 1))}
                aria-label="Больше"
                disabled={qty >= stock}
              >
                +
              </button>
            </div>
          </div>

          <button type="button" className="btn btn-primary myshop-add-btn" onClick={handleAdd} disabled={!canAdd}>
            В корзину
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [selectedProduct, setSelectedProduct] = useState(null);
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

  const productsById = useMemo(
    () => new Map((catalog?.products || []).map((p) => [p.id, p])),
    [catalog?.products],
  );

  const handleAddToCart = (item) => {
    const next = addCartItem(branchId, item);
    setCartItems(next);
    setView('cart');
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
          onProductOpen={setSelectedProduct}
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
            <nav className="myshop-bottom-nav" aria-label="Меню магазина">
              <button type="button" className="myshop-bottom-nav-item" onClick={() => handleNav('menu')}>Меню</button>
              <button type="button" className="myshop-bottom-nav-item active" onClick={() => handleNav('cart')}>
                Корзина{count > 0 ? ` (${count})` : ''}
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

      {selectedProduct && view === 'menu' && (
        <PublicProductSheet
          product={productsById.get(selectedProduct.id) || selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAdd={handleAddToCart}
        />
      )}
    </div>
  );
}
