import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  api,
  formatDate,
  formatMoney,
  parseQuantityInput,
  normalizeQuantityInput,
  STATUS_LABELS,
} from '../api';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useTheme } from '../ThemeContext';
import { hasPermission } from '../permissions';
import Login from './Login';
import ChangePassword from './ChangePassword';
import { IconNavWarehouse, IconNavLogout, IconNavSun, IconNavMoon, IconNavRefresh } from '../components/NavIcons';
import {
  buildProductPickOptions,
  encodeProductPick,
  getPickStock,
  resolvePickFromProducts,
} from '../utils/productVariants';
import { todayLocalIso } from '../utils/date';

const emptyItem = { product_id: '', variant_id: null, quantity: '1', price: 0, net_weight: '' };

const DIR_FILTERS = [
  { value: 'in', label: 'Входящие' },
  { value: 'out', label: 'Исходящие' },
  { value: 'all', label: 'Все' },
];

function statusClass(status) {
  if (status === 'confirmed') return 'badge badge-confirmed';
  if (status === 'draft') return 'badge badge-draft';
  if (status === 'cancelled') return 'badge badge-cancelled';
  return 'badge';
}

function lineStockQty(item) {
  const qty = Number(item.quantity) || 0;
  const net = Number(item.net_weight) || 0;
  return net > 0 ? net * qty : qty;
}

export default function TransferMobile() {
  const { user, loading: authLoading, logout } = useAuth();
  const { branchName, branchId } = useBranch();
  const { theme, toggleTheme } = useTheme();

  const canTransfer = hasPermission(user, 'documents.transfer');
  const canEdit = hasPermission(user, 'documents.edit');
  const canConfirm = hasPermission(user, 'documents.confirm');
  const canOrders = hasPermission(user, 'shop_orders.view');
  const canPrihod = hasPermission(user, 'documents.prihod');
  const myDeptId = user?.department_id || null;
  const myDeptName = user?.department_name || 'Мой отдел';

  const [view, setView] = useState('list'); // list | create | detail
  const [createStep, setCreateStep] = useState(1);
  const [docs, setDocs] = useState([]);
  const [direction, setDirection] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');

  const [departments, setDepartments] = useState([]);
  const [products, setProducts] = useState([]);
  const [stockMap, setStockMap] = useState({});
  const [productSearch, setProductSearch] = useState('');
  const [form, setForm] = useState({
    to_department_id: '',
    date: todayLocalIso(),
    comment: '',
    items: [{ ...emptyItem }],
  });

  const targetDepartments = useMemo(
    () => (departments || []).filter((d) => d.id !== myDeptId && d.active !== false && d.active !== 0),
    [departments, myDeptId],
  );

  const loadDocs = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const params = { type: 'peremeshchenie' };
      if (direction === 'in' || direction === 'out') params.direction = direction;
      const data = await api.getDocuments(params);
      setDocs(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) {
        setDocs([]);
        setNotice(err.message || 'Не удалось загрузить перемещения');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [direction]);

  const loadCatalog = useCallback(async () => {
    try {
      const [depts, prods] = await Promise.all([
        api.getDepartments({ active: 1 }),
        api.getProducts({ limit: 5000 }),
      ]);
      setDepartments(Array.isArray(depts) ? depts : []);
      setProducts(Array.isArray(prods) ? prods : (prods?.items || []));
      if (myDeptId) {
        try {
          const snap = await api.getInventoryStock(myDeptId);
          const map = {};
          for (const row of (Array.isArray(snap) ? snap : [])) {
            const key = `${row.product_id}::${row.variant_id || ''}`;
            map[key] = Number(row.book_qty) || 0;
          }
          setStockMap(map);
        } catch {
          setStockMap({});
        }
      }
    } catch {
      setDepartments([]);
      setProducts([]);
    }
  }, [myDeptId]);

  useEffect(() => {
    if (!user || !myDeptId || !canTransfer) return undefined;
    loadDocs();
    return undefined;
  }, [user, myDeptId, canTransfer, loadDocs]);

  useEffect(() => {
    if (!user || !myDeptId) return undefined;
    loadCatalog();
    return undefined;
  }, [user, myDeptId, loadCatalog, branchId]);

  const pickOptions = useMemo(() => buildProductPickOptions(products), [products]);
  const filteredPicks = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return pickOptions.slice(0, 40);
    return pickOptions.filter((p) => (p.label || '').toLowerCase().includes(q)).slice(0, 40);
  }, [pickOptions, productSearch]);

  const getSourceStock = (productId, variantId) => {
    const key = `${productId}::${variantId || ''}`;
    if (stockMap[key] != null) return stockMap[key];
    const resolved = resolvePickFromProducts(products, encodeProductPick(productId, variantId));
    return getPickStock(resolved.product, resolved.variant);
  };

  const openCreate = () => {
    setForm({
      to_department_id: '',
      date: todayLocalIso(),
      comment: '',
      items: [{ ...emptyItem }],
    });
    setProductSearch('');
    setCreateStep(1);
    setView('create');
    setNotice('');
  };

  const openDetail = async (doc) => {
    try {
      const full = await api.getDocument(doc.id);
      setSelected(full);
      setView('detail');
    } catch (err) {
      setNotice(err.message || 'Не удалось открыть документ');
    }
  };

  const closeToList = () => {
    setView('list');
    setSelected(null);
    setCreateStep(1);
  };

  const updateItem = (idx, field, value) => {
    setForm((prev) => {
      const items = [...prev.items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...prev, items };
    });
  };

  const setItemProduct = (idx, pick) => {
    const resolved = resolvePickFromProducts(products, pick);
    setForm((prev) => {
      const items = [...prev.items];
      items[idx] = {
        ...items[idx],
        product_id: resolved.product?.id || '',
        variant_id: resolved.variant?.id || null,
        price: resolved.product?.price || 0,
        net_weight: resolved.product?.net_weight != null && resolved.product.net_weight !== ''
          ? String(resolved.product.net_weight)
          : '',
      };
      return { ...prev, items };
    });
  };

  const addItem = () => setForm((prev) => ({ ...prev, items: [...prev.items, { ...emptyItem }] }));
  const removeItem = (idx) => setForm((prev) => ({
    ...prev,
    items: prev.items.length <= 1 ? prev.items : prev.items.filter((_, i) => i !== idx),
  }));

  const submitTransfer = async () => {
    if (!form.to_department_id) {
      setNotice('Выберите отдел назначения');
      setCreateStep(1);
      return;
    }
    const items = form.items
      .filter((i) => i.product_id)
      .map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id || null,
        quantity: parseQuantityInput(i.quantity) || 0,
        price: Number(i.price) || 0,
        amount: (parseQuantityInput(i.quantity) || 0) * (Number(i.price) || 0),
        net_weight: i.net_weight !== '' && i.net_weight != null ? Number(i.net_weight) : null,
      }))
      .filter((i) => i.quantity > 0);
    if (!items.length) {
      setNotice('Добавьте хотя бы один товар');
      setCreateStep(2);
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      await api.createDocument({
        type: 'peremeshchenie',
        date: form.date,
        comment: form.comment || '',
        from_department_id: myDeptId,
        to_department_id: form.to_department_id,
        from_branch_id: branchId,
        to_branch_id: branchId,
        items,
        status: canConfirm ? 'confirmed' : 'draft',
      });
      setNotice(canConfirm ? 'Перемещение отправлено' : 'Черновик сохранён');
      closeToList();
      await loadDocs({ silent: true });
      await loadCatalog();
    } catch (err) {
      setNotice(err.message || 'Не удалось отправить');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return <div className="warehouse-orders-mobile-shell"><div className="warehouse-orders-mobile-empty">Загрузка...</div></div>;
  }
  if (!user) return <Login />;
  if (user.must_change_password) return <ChangePassword />;
  if (!canTransfer || !myDeptId) {
    return <Navigate to={canOrders ? '/warehouse/orders' : '/'} replace />;
  }

  const navTabs = (canOrders || canPrihod) ? (
    <nav className="warehouse-orders-mobile-nav" aria-label="Разделы">
      {canOrders && <Link to="/warehouse/orders" className="warehouse-orders-mobile-nav-tab">Заявки</Link>}
      {canPrihod && <Link to="/warehouse/prihod" className="warehouse-orders-mobile-nav-tab">Приход</Link>}
      <Link to="/warehouse/transfer" className="warehouse-orders-mobile-nav-tab active" aria-current="page">
        Перемещение
      </Link>
    </nav>
  ) : null;

  const isIncoming = (doc) => doc.to_department_id === myDeptId && doc.from_department_id !== myDeptId;

  return (
    <div className="warehouse-orders-mobile-shell public-shop-snappy transfer-mobile">
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
                <strong>Перемещение</strong>
                <span>{myDeptName} · {branchName}</span>
              </div>
            </div>
            <div className="warehouse-orders-mobile-header-actions">
              <button type="button" className="warehouse-orders-mobile-icon-btn" onClick={toggleTheme} aria-label="Тема">
                {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
              </button>
              <button type="button" className="warehouse-orders-mobile-icon-btn" onClick={() => loadDocs()} aria-label="Обновить">
                <IconNavRefresh />
              </button>
              <button type="button" className="warehouse-orders-mobile-icon-btn" onClick={logout} aria-label="Выйти">
                <IconNavLogout />
              </button>
            </div>
          </header>

          {navTabs}

          <div className="warehouse-orders-mobile-filters" role="tablist" aria-label="Направление">
            {DIR_FILTERS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={direction === opt.value}
                className={`warehouse-orders-mobile-chip${direction === opt.value ? ' active' : ''}`}
                onClick={() => setDirection(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className={`warehouse-orders-mobile-list${canEdit && canConfirm ? ' warehouse-orders-mobile-list--fab' : ''}`}>
            {loading && docs.length === 0 ? (
              <div className="warehouse-orders-mobile-empty">Загрузка...</div>
            ) : docs.length === 0 ? (
              <div className="warehouse-orders-mobile-empty">Перемещений пока нет</div>
            ) : (
              docs.map((doc) => {
                const incoming = isIncoming(doc);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    className="warehouse-orders-mobile-card"
                    onClick={() => openDetail(doc)}
                  >
                    <div className="warehouse-orders-mobile-card-top">
                      <strong>№{doc.number}</strong>
                      <span className={statusClass(doc.status)}>
                        {STATUS_LABELS[doc.status] || doc.status}
                      </span>
                    </div>
                    <div className="warehouse-orders-mobile-card-client">
                      {incoming
                        ? `← ${doc.from_department_name || 'Отдел'} → вам`
                        : `${doc.from_department_name || myDeptName} → ${doc.to_department_name || 'Отдел'}`}
                    </div>
                    <div className="warehouse-orders-mobile-card-meta">
                      <span>{formatDate(doc.date)}</span>
                      <span className={incoming ? 'transfer-dir-in' : 'transfer-dir-out'}>
                        {incoming ? 'Вам' : 'От вас'}
                      </span>
                    </div>
                    <div className="warehouse-orders-mobile-card-bottom">
                      <span>Перемещение</span>
                      <strong>{formatMoney(doc.total_amount)}</strong>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {canEdit && (
            <button type="button" className="warehouse-prihod-fab" onClick={openCreate}>
              + Перемещение
            </button>
          )}
        </>
      )}

      {view === 'create' && (
        <div className="warehouse-orders-mobile-detail">
          <header className="warehouse-orders-mobile-detail-header">
            <button type="button" className="warehouse-orders-mobile-back" onClick={closeToList}>
              ← Назад
            </button>
            <h1>{createStep === 1 ? 'Куда' : 'Товары'}</h1>
          </header>

          <div className="transfer-mobile-steps" role="tablist">
            <button
              type="button"
              className={`warehouse-orders-mobile-chip${createStep === 1 ? ' active' : ''}`}
              onClick={() => setCreateStep(1)}
            >
              1. Куда
            </button>
            <button
              type="button"
              className={`warehouse-orders-mobile-chip${createStep === 2 ? ' active' : ''}`}
              onClick={() => setCreateStep(2)}
            >
              2. Товары
            </button>
          </div>

          <div className="warehouse-orders-mobile-detail-body">
            <p className="transfer-mobile-from">Откуда: <strong>{myDeptName}</strong></p>

            {createStep === 1 && (
              <>
                <label className="warehouse-orders-mobile-field">
                  <span>Дата</span>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                  />
                </label>
                <div className="transfer-dept-cubes" role="listbox" aria-label="Отдел назначения">
                  {targetDepartments.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      role="option"
                      aria-selected={form.to_department_id === d.id}
                      className={`transfer-dept-cube${form.to_department_id === d.id ? ' is-active' : ''}`}
                      onClick={() => setForm((p) => ({ ...p, to_department_id: d.id }))}
                    >
                      {d.name}
                    </button>
                  ))}
                  {targetDepartments.length === 0 && (
                    <p className="form-hint">Нет других отделов в филиале</p>
                  )}
                </div>
                <label className="warehouse-orders-mobile-field">
                  <span>Комментарий</span>
                  <input
                    value={form.comment}
                    onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
                    placeholder="Необязательно"
                  />
                </label>
              </>
            )}

            {createStep === 2 && (
              <>
                <label className="warehouse-orders-mobile-field">
                  <span>Поиск товара</span>
                  <input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Название…"
                  />
                </label>
                {form.items.map((item, idx) => {
                  const stock = item.product_id ? getSourceStock(item.product_id, item.variant_id) : null;
                  const netVal = Number(item.net_weight) || 0;
                  const pieceRemain = stock != null && netVal > 0 ? stock / netVal : stock;
                  const over = stock != null && lineStockQty(item) > stock + 1e-9;
                  return (
                    <div key={idx} className={`transfer-mobile-item${over ? ' is-over' : ''}`}>
                      <label className="warehouse-orders-mobile-field">
                        <span>Товар {idx + 1}</span>
                        <select
                          value={encodeProductPick(item.product_id, item.variant_id)}
                          onChange={(e) => setItemProduct(idx, e.target.value)}
                        >
                          <option value="">Выберите…</option>
                          {filteredPicks.map((p) => (
                            <option key={p.key} value={p.key}>{p.label}</option>
                          ))}
                        </select>
                      </label>
                      <div className="transfer-mobile-item-row">
                        <label className="warehouse-orders-mobile-field">
                          <span>Кол-во</span>
                          <input
                            inputMode="decimal"
                            value={item.quantity}
                            onChange={(e) => updateItem(idx, 'quantity', normalizeQuantityInput(e.target.value))}
                          />
                          {pieceRemain != null && item.product_id && (
                            <small className="transfer-remain">ост. {Number(pieceRemain).toFixed(2)} шт</small>
                          )}
                        </label>
                        <label className="warehouse-orders-mobile-field">
                          <span>Нетто</span>
                          <input
                            inputMode="decimal"
                            value={item.net_weight}
                            onChange={(e) => updateItem(idx, 'net_weight', normalizeQuantityInput(e.target.value))}
                          />
                          {stock != null && item.product_id && (
                            <small className="transfer-remain">склад {Number(stock).toFixed(2)}</small>
                          )}
                        </label>
                      </div>
                      {form.items.length > 1 && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeItem(idx)}>
                          Удалить строку
                        </button>
                      )}
                    </div>
                  );
                })}
                <button type="button" className="btn btn-ghost" onClick={addItem}>+ Товар</button>
              </>
            )}
          </div>

          <footer className="warehouse-orders-mobile-detail-footer">
            {createStep === 1 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!form.to_department_id}
                onClick={() => setCreateStep(2)}
              >
                Далее
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setCreateStep(1)}>
                  Назад
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !canEdit}
                  onClick={submitTransfer}
                >
                  {saving ? 'Отправка…' : (canConfirm ? 'Отправить' : 'Сохранить')}
                </button>
              </>
            )}
          </footer>
        </div>
      )}

      {view === 'detail' && selected && (
        <div className="warehouse-orders-mobile-detail">
          <header className="warehouse-orders-mobile-detail-header">
            <button type="button" className="warehouse-orders-mobile-back" onClick={closeToList}>
              ← Назад
            </button>
            <h1>№{selected.number}</h1>
          </header>
          <div className="warehouse-orders-mobile-detail-body">
            <div className="warehouse-orders-mobile-card-meta">
              <span>{formatDate(selected.date)}</span>
              <span className={statusClass(selected.status)}>
                {STATUS_LABELS[selected.status] || selected.status}
              </span>
            </div>
            <p className="transfer-mobile-from">
              {selected.from_department_name || '—'} → {selected.to_department_name || '—'}
            </p>
            {selected.comment && <p className="form-hint">{selected.comment}</p>}
            <ul className="transfer-mobile-lines">
              {(selected.items || []).map((item) => (
                <li key={item.id || `${item.product_id}-${item.variant_id}`}>
                  <strong>{item.product_name || item.product_id}</strong>
                  <span>
                    {item.quantity}
                    {item.net_weight ? ` × нетто ${item.net_weight}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <div className="warehouse-orders-mobile-card-bottom">
              <span>Итого</span>
              <strong>{formatMoney(selected.total_amount)}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
