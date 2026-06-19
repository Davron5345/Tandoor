import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, formatDateTime, formatMoney } from '../api';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useTheme } from '../ThemeContext';
import { hasPermission } from '../permissions';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import Login from './Login';
import ChangePassword from './ChangePassword';
import ShopOrderItem from '../components/ShopOrderItem';
import { IconNavWarehouse, IconNavLogout, IconNavSun, IconNavMoon, IconNavRefresh } from '../components/NavIcons';

const STATUS_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'processing', label: 'В работе' },
  { value: 'done', label: 'Готовы' },
  { value: 'cancelled', label: 'Отмена' },
];

const STATUS_ACTIONS = [
  { value: 'new', label: 'Новый' },
  { value: 'processing', label: 'В работе' },
  { value: 'done', label: 'Выполнен' },
  { value: 'cancelled', label: 'Отменён' },
];

const STATUS_CLASS = {
  new: 'shop-order-status-new',
  processing: 'shop-order-status-processing',
  done: 'shop-order-status-done',
  cancelled: 'shop-order-status-cancelled',
};

export default function ShopOrdersMobile() {
  const { user, loading: authLoading, logout } = useAuth();
  const { branchName, branchId } = useBranch();
  const { theme, toggleTheme } = useTheme();
  const canView = hasPermission(user, 'shop_orders.view');
  const canEdit = hasPermission(user, 'shop_orders.edit');

  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.getShopOrders(statusFilter ? { status: statusFilter } : {});
      setOrders(data);
    } catch (err) {
      if (!silent) {
        setOrders([]);
        setNotice(err.message || 'Не удалось загрузить заказы');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [statusFilter, branchId]);

  useEffect(() => { if (canView) load(); }, [load, canView]);
  useAutoRefresh(
    () => load({ silent: true }),
    [statusFilter, branchId],
    { enabled: canView && view === 'list', intervalMs: 60_000 },
  );

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
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Заказы — склад';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  const openOrder = async (order) => {
    try {
      const full = await api.getShopOrder(order.id);
      setSelected(full);
      setView('detail');
    } catch (err) {
      setNotice(err.message || 'Не удалось открыть заказ');
    }
  };

  const closeDetail = () => {
    setView('list');
    setSelected(null);
  };

  const changeStatus = async (status) => {
    if (!selected || !canEdit) return;
    setUpdating(true);
    try {
      const updated = await api.updateShopOrderStatus(selected.id, status);
      setSelected(updated);
      setNotice('Статус обновлён');
      load({ silent: true });
    } catch (err) {
      setNotice(err.message || 'Не удалось обновить статус');
    } finally {
      setUpdating(false);
    }
  };

  if (authLoading) {
    return (
      <div className="warehouse-orders-mobile-shell">
        <div className="warehouse-orders-mobile-empty">Загрузка...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (user.must_change_password) {
    return <ChangePassword />;
  }

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="warehouse-orders-mobile-shell public-shop-snappy">
      {notice && (
        <div className="warehouse-orders-mobile-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Закрыть">×</button>
        </div>
      )}

      {view === 'list' && (
        <>
          <header className="warehouse-orders-mobile-header">
            <div className="warehouse-orders-mobile-brand">
              <span className="warehouse-orders-mobile-mark" aria-hidden><IconNavWarehouse /></span>
              <div>
                <strong>Заказы</strong>
                <span>{branchName}</span>
              </div>
            </div>
            <div className="warehouse-orders-mobile-header-actions">
              <button
                type="button"
                className="warehouse-orders-mobile-icon-btn"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
                title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              >
                {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
              </button>
              <button type="button" className="warehouse-orders-mobile-icon-btn" onClick={() => load()} aria-label="Обновить" title="Обновить">
                <IconNavRefresh />
              </button>
              <button type="button" className="warehouse-orders-mobile-icon-btn" onClick={logout} aria-label="Выйти" title="Выйти">
                <IconNavLogout />
              </button>
            </div>
          </header>

          <div className="warehouse-orders-mobile-filters" role="tablist" aria-label="Фильтр по статусу">
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.value || 'all'}
                type="button"
                role="tab"
                aria-selected={statusFilter === opt.value}
                className={`warehouse-orders-mobile-chip${statusFilter === opt.value ? ' active' : ''}`}
                onClick={() => setStatusFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="warehouse-orders-mobile-list">
            {loading && orders.length === 0 ? (
              <div className="warehouse-orders-mobile-empty">Загрузка...</div>
            ) : orders.length === 0 ? (
              <div className="warehouse-orders-mobile-empty">Заказов пока нет</div>
            ) : (
              orders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  className="warehouse-orders-mobile-card"
                  onClick={() => openOrder(order)}
                >
                  <div className="warehouse-orders-mobile-card-top">
                    <strong>№{order.number}</strong>
                    <span className={`shop-order-status ${STATUS_CLASS[order.status] || ''}`}>
                      {order.status_label || order.status}
                    </span>
                  </div>
                  <div className="warehouse-orders-mobile-card-meta">
                    <span>{formatDateTime(order.created_at)}</span>
                    {order.department_name && <span>{order.department_name}</span>}
                  </div>
                  <div className="warehouse-orders-mobile-card-client">{order.customer_name}</div>
                  <div className="warehouse-orders-mobile-card-bottom">
                    <span>{order.delivery_type === 'delivery' ? 'Доставка' : 'Самовывоз'}</span>
                    <strong>{formatMoney(order.total_amount)}</strong>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {view === 'detail' && selected && (
        <div className="warehouse-orders-mobile-detail">
          <header className="warehouse-orders-mobile-detail-header">
            <button type="button" className="warehouse-orders-mobile-back" onClick={closeDetail}>
              ← Назад
            </button>
            <h2>Заказ №{selected.number}</h2>
            <button
              type="button"
              className="warehouse-orders-mobile-icon-btn warehouse-orders-mobile-detail-theme"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
            </button>
          </header>

          <div className="warehouse-orders-mobile-detail-body">
            <div className="warehouse-orders-mobile-detail-total">
              <span>Итого</span>
              <strong>{formatMoney(selected.total_amount)}</strong>
            </div>

            {canEdit && (
              <div className="shop-order-status-actions">
                <span>Статус заказа</span>
                <div className="shop-order-status-buttons">
                  {STATUS_ACTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`btn btn-sm${selected.status === opt.value ? ' btn-primary' : ' btn-ghost'}`}
                      disabled={updating || selected.status === opt.value}
                      onClick={() => changeStatus(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="shop-order-detail-grid warehouse-orders-mobile-detail-grid">
              <div><span>Клиент</span><strong>{selected.customer_name}</strong></div>
              {selected.department_name && (
                <div><span>Отдел</span><strong>{selected.department_name}</strong></div>
              )}
              <div><span>Телефон</span><strong>{selected.customer_phone}</strong></div>
              <div><span>Способ</span><strong>{selected.delivery_type === 'delivery' ? 'Доставка' : 'Самовывоз'}</strong></div>
              <div><span>Дата и время</span><strong>{formatDateTime(selected.created_at)}</strong></div>
              {selected.address && (
                <div className="shop-order-detail-wide"><span>Адрес</span><strong>{selected.address}</strong></div>
              )}
              {selected.comment && (
                <div className="shop-order-detail-wide"><span>Комментарий</span><strong>{selected.comment}</strong></div>
              )}
            </div>

            <div className="shop-order-items warehouse-orders-mobile-items">
              <h3>Товары</h3>
              <ul>
                {(selected.items || []).map((item) => (
                  <ShopOrderItem key={item.id} item={item} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
