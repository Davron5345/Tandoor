import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatMoney } from '../api';
import Modal, { useToast } from '../components/Modal';
import { hasPermission } from '../permissions';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
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

export default function ShopOrders() {
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const { show, Toast } = useToast();
  const canEdit = hasPermission(user, 'shop_orders.edit');

  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getShopOrders(statusFilter ? { status: statusFilter } : {});
      setOrders(data);
    } catch (err) {
      show(err.message || 'Не удалось загрузить заказы', 'error');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, show, branchId]);

  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(load, [load, branchId], { enabled: !selected });

  const openOrder = async (order) => {
    try {
      const full = await api.getShopOrder(order.id);
      setSelected(full);
    } catch (err) {
      show(err.message || 'Не удалось открыть заказ', 'error');
    }
  };

  const changeStatus = async (status) => {
    if (!selected || !canEdit) return;
    setUpdating(true);
    try {
      const updated = await api.updateShopOrderStatus(selected.id, status);
      setSelected(updated);
      show('Статус обновлён');
      load();
    } catch (err) {
      show(err.message || 'Не удалось обновить статус', 'error');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="page">
      {Toast}
      <div className="page-header">
        <div>
          <h1>Заказы MyShop</h1>
          <p className="page-subtitle">{branchName} · онлайн-заказы клиентов</p>
        </div>
      </div>

      <div className="card shop-orders-toolbar">
        <label className="shop-orders-filter">
          <span>Статус</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty">Загрузка...</div>
        ) : orders.length === 0 ? (
          <div className="empty">Заказов пока нет</div>
        ) : (
          <div className="table-wrap">
            <table className="table shop-orders-table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Дата</th>
                  <th>Клиент</th>
                  <th>Телефон</th>
                  <th>Способ</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.number}</td>
                    <td>{formatDate(order.created_at)}</td>
                    <td>{order.customer_name}</td>
                    <td>{order.customer_phone}</td>
                    <td>{order.delivery_type === 'delivery' ? 'Доставка' : 'Самовывоз'}</td>
                    <td>{formatMoney(order.total_amount)}</td>
                    <td>
                      <span className={`shop-order-status ${STATUS_CLASS[order.status] || ''}`}>
                        {order.status_label || order.status}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openOrder(order)}>
                        Открыть
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <Modal title={`Заказ №${selected.number}`} onClose={() => setSelected(null)} wide className="modal-shop-order">
          <div className="shop-order-detail">
            <div className="shop-order-detail-sticky">
              <div className="shop-order-total">
                <span>Итого</span>
                <strong>{formatMoney(selected.total_amount)}</strong>
              </div>

              {canEdit && (
                <div className="shop-order-status-actions">
                  <span>Статус заказа</span>
                  <div className="shop-order-status-buttons">
                    {STATUS_OPTIONS.filter((o) => o.value).map((opt) => (
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
            </div>

            <div className="shop-order-detail-scroll">
              <div className="shop-order-detail-grid">
                <div><span>Клиент</span><strong>{selected.customer_name}</strong></div>
                <div><span>Телефон</span><strong>{selected.customer_phone}</strong></div>
                <div><span>Способ</span><strong>{selected.delivery_type === 'delivery' ? 'Доставка' : 'Самовывоз'}</strong></div>
                <div><span>Дата</span><strong>{formatDate(selected.created_at)}</strong></div>
                {selected.address && (
                  <div className="shop-order-detail-wide"><span>Адрес</span><strong>{selected.address}</strong></div>
                )}
                {selected.comment && (
                  <div className="shop-order-detail-wide"><span>Комментарий</span><strong>{selected.comment}</strong></div>
                )}
              </div>

              <div className="shop-order-items">
                <h3>Товары</h3>
                <ul>
                  {(selected.items || []).map((item) => (
                    <li key={item.id}>
                      <span>
                        {item.variant_name ? `${item.product_name} — ${item.variant_name}` : item.product_name}
                        {' · '}
                        {item.quantity} {item.unit || 'шт'} × {formatMoney(item.price)}
                      </span>
                      <strong>{formatMoney(item.line_total)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
