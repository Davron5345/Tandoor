import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  api,
  formatDate,
  formatMoney,
  formatPriceInput,
  parsePriceInput,
  parseQuantityInput,
  normalizeQuantityInput,
  lineMoneyFromItem,
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
  getPickPrice,
  resolvePickFromProducts,
} from '../utils/productVariants';
import { todayLocalIso } from '../utils/date';
import { allocateExtraCosts, extraCostsTotal, capitalizedExtraTotal } from '../utils/documentExtraCosts';

const DEFAULT_CONTRACT_ID = '__default__';
const emptyItem = { product_id: '', variant_id: null, quantity: '1', price: 0, net_weight: '' };
const emptyExtraCost = { title: '', amount: '', capitalize: true };

const STATUS_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'draft', label: 'Черновик' },
  { value: 'confirmed', label: 'Проведён' },
];

function statusClass(status) {
  if (status === 'confirmed') return 'badge badge-confirmed';
  if (status === 'draft') return 'badge badge-draft';
  if (status === 'cancelled') return 'badge badge-cancelled';
  return 'badge';
}

export default function PrihodMobile() {
  const { user, loading: authLoading, logout } = useAuth();
  const {
    branchName,
    branchId,
    branches,
    setActiveBranchId,
    isAdmin: isBranchAdmin,
  } = useBranch();
  const { theme, toggleTheme } = useTheme();
  const activeBranches = useMemo(
    () => (branches || []).filter((b) => b.active !== false && b.active !== 0),
    [branches],
  );
  const canSwitchBranch = isBranchAdmin && activeBranches.length > 0;

  const canView = hasPermission(user, 'documents.prihod') || hasPermission(user, 'documents.view');
  const canEdit = hasPermission(user, 'documents.edit');
  const canConfirm = hasPermission(user, 'documents.confirm');
  const canOrders = hasPermission(user, 'shop_orders.view');

  const [view, setView] = useState('list');
  const [docs, setDocs] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');

  const [suppliers, setSuppliers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    counterparty_id: '',
    to_department_id: '',
    date: todayLocalIso(),
    items: [{ ...emptyItem }],
    extra_costs: [],
  });

  const loadDocs = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const params = { type: 'prihod' };
      if (statusFilter) params.status = statusFilter;
      const data = await api.getDocuments(params);
      setDocs(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!silent) {
        setDocs([]);
        setNotice(err.message || 'Не удалось загрузить приходы');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [statusFilter, branchId]);

  useEffect(() => {
    if (canView) loadDocs();
  }, [loadDocs, canView]);

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
    document.title = 'Снабжение — приход';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  const loadCreateRefs = useCallback(async () => {
    try {
      const [supps, depts] = await Promise.all([
        api.getCounterparties('supplier'),
        api.getDepartments({ active: '1' }),
      ]);
      setSuppliers(Array.isArray(supps) ? supps : []);
      setDepartments(Array.isArray(depts) ? depts : []);
    } catch (err) {
      setNotice(err.message || 'Не удалось загрузить справочники');
    }
  }, [branchId]);

  useEffect(() => {
    if (view !== 'create') return;
    setForm({
      counterparty_id: '',
      to_department_id: '',
      date: todayLocalIso(),
      items: [{ ...emptyItem }],
      extra_costs: [],
    });
    setProducts([]);
    loadCreateRefs();
  }, [branchId, view, loadCreateRefs]);

  const loadProducts = useCallback(async (supplierId, departmentId) => {
    if (!supplierId) {
      setProducts([]);
      return;
    }
    try {
      const params = {
        last_doc_type: 'prihod',
        supplier_id: supplierId,
        counterparty_id: supplierId,
      };
      if (departmentId) params.department_id = departmentId;
      const data = await api.getProducts(params);
      const list = Array.isArray(data) ? data : (data?.items || []);
      setProducts(list);
    } catch (err) {
      setProducts([]);
      setNotice(err.message || 'Не удалось загрузить товары');
    }
  }, [branchId]);

  useEffect(() => {
    if (view !== 'create') return;
    loadProducts(form.counterparty_id, form.to_department_id);
  }, [view, form.counterparty_id, form.to_department_id, loadProducts, branchId]);

  const productOptions = useMemo(() => buildProductPickOptions(products), [products]);

  const formTotal = form.items.reduce(
    (sum, item) => sum + lineMoneyFromItem(item).amount,
    0,
  );
  const extrasParsed = (form.extra_costs || []).map((e) => ({
    ...e,
    amount: parsePriceInput(e.amount) ?? 0,
  }));
  const extrasTotal = extraCostsTotal(extrasParsed);
  const extrasCapitalized = capitalizedExtraTotal(extrasParsed);
  const extraAllocations = allocateExtraCosts(form.items, extrasParsed);

  const openCreate = () => {
    if (!canEdit) return;
    setView('create');
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
    loadDocs({ silent: true });
  };

  const setSupplier = (counterpartyId) => {
    setForm((prev) => ({
      ...prev,
      counterparty_id: counterpartyId,
      items: prev.items.map((item) => ({ ...item, product_id: '', variant_id: null, price: 0, net_weight: '' })),
    }));
  };

  const updateItem = (idx, patch) => {
    setForm((prev) => {
      const items = [...prev.items];
      const next = { ...items[idx], ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'quantity')
        || Object.prototype.hasOwnProperty.call(patch, 'price')) {
        next.amount_input = undefined;
        next.amount = undefined;
      }
      items[idx] = next;
      return { ...prev, items };
    });
  };

  const updateItemAmount = (idx, raw) => {
    const formatted = formatPriceInput(raw);
    const amount = parsePriceInput(formatted);
    setForm((prev) => {
      const items = [...prev.items];
      const qty = parseQuantityInput(items[idx].quantity) ?? 0;
      if (amount == null) {
        items[idx] = {
          ...items[idx],
          amount_input: formatted,
          amount: undefined,
        };
      } else {
        items[idx] = {
          ...items[idx],
          amount_input: formatted,
          amount,
          price: qty > 0 ? amount / qty : items[idx].price,
        };
      }
      return { ...prev, items };
    });
  };

  const onProductPick = (idx, pickValue) => {
    const resolved = resolvePickFromProducts(products, pickValue);
    const price = resolved.product
      ? getPickPrice(resolved.product, resolved.variant)
      : 0;
    const nw = resolved.product?.net_weight;
    updateItem(idx, {
      product_id: resolved.productId || '',
      variant_id: resolved.variantId || null,
      price: Number(price) || 0,
      net_weight: nw != null && nw !== '' ? nw : '',
    });
  };

  const addItem = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, { ...emptyItem }] }));
  };

  const removeItem = (idx) => {
    setForm((prev) => {
      if (prev.items.length <= 1) return prev;
      return { ...prev, items: prev.items.filter((_, i) => i !== idx) };
    });
  };

  const updateExtraCost = (idx, patch) => {
    setForm((prev) => {
      const extra_costs = [...(prev.extra_costs || [])];
      extra_costs[idx] = { ...extra_costs[idx], ...patch };
      return { ...prev, extra_costs };
    });
  };

  const addExtraCost = () => {
    setForm((prev) => ({
      ...prev,
      extra_costs: [...(prev.extra_costs || []), { ...emptyExtraCost }],
    }));
  };

  const removeExtraCost = (idx) => {
    setForm((prev) => ({
      ...prev,
      extra_costs: (prev.extra_costs || []).filter((_, i) => i !== idx),
    }));
  };

  const buildPayload = (status) => {
    if (!form.counterparty_id) {
      setNotice('Выберите поставщика');
      return null;
    }
    if (!form.to_department_id) {
      setNotice('Выберите отдел');
      return null;
    }
    const items = form.items.filter((i) => i.product_id);
    if (items.length === 0) {
      setNotice('Добавьте хотя бы один товар');
      return null;
    }
    if (items.some((i) => !(parseQuantityInput(i.quantity) > 0))) {
      setNotice('Укажите количество больше нуля');
      return null;
    }
    return {
      type: 'prihod',
      counterparty_id: form.counterparty_id,
      contract_id: DEFAULT_CONTRACT_ID,
      to_department_id: form.to_department_id,
      date: form.date || todayLocalIso(),
      comment: '',
      status,
      items: items.map((i) => {
        const money = lineMoneyFromItem(i);
        return {
          product_id: i.product_id,
          variant_id: i.variant_id || null,
          quantity: money.quantity,
          price: money.price,
          amount: money.amount,
          net_weight: i.net_weight !== '' && i.net_weight != null ? Number(i.net_weight) : null,
        };
      }),
      extra_costs: (form.extra_costs || []).map((e) => ({
        title: e.title,
        amount: parsePriceInput(e.amount) ?? 0,
        capitalize: e.capitalize !== false,
      })),
    };
  };

  const submit = async (status) => {
    if (!canEdit || saving) return;
    const payload = buildPayload(status);
    if (!payload) return;
    setSaving(true);
    try {
      await api.createDocument(payload);
      setNotice(status === 'confirmed' ? 'Приход создан и проведён' : 'Черновик сохранён');
      closeToList();
    } catch (err) {
      setNotice(err.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const confirmSelected = async () => {
    if (!selected || !canConfirm || saving) return;
    setSaving(true);
    try {
      await api.confirmDocument(selected.id);
      setNotice('Документ проведён');
      closeToList();
    } catch (err) {
      setNotice(err.message || 'Не удалось провести');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="warehouse-orders-mobile-shell">
        <div className="warehouse-orders-mobile-empty">Загрузка...</div>
      </div>
    );
  }

  if (!user) return <Login />;
  if (user.must_change_password) return <ChangePassword />;
  if (!canView) return <Navigate to="/" replace />;

  const navTabs = canOrders && (
    <nav className="warehouse-orders-mobile-nav" aria-label="Разделы снабжения">
      <Link to="/warehouse/orders" className="warehouse-orders-mobile-nav-tab">
        Заявки
      </Link>
      <Link
        to="/warehouse/prihod"
        className="warehouse-orders-mobile-nav-tab active"
        aria-current="page"
      >
        Приход
      </Link>
    </nav>
  );

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
                <strong>Приход</strong>
                <span>{branchName}</span>
              </div>
            </div>
            <div className="warehouse-orders-mobile-header-actions">
              <button
                type="button"
                className="warehouse-orders-mobile-icon-btn"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              >
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

          {canSwitchBranch ? (
            <label className="warehouse-orders-mobile-branch">
              <span>Филиал</span>
              <select
                value={branchId || ''}
                onChange={(e) => setActiveBranchId(e.target.value)}
                aria-label="Выбор филиала"
              >
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="warehouse-orders-mobile-branch warehouse-orders-mobile-branch--static">
              <span>Филиал</span>
              <strong>{branchName}</strong>
            </div>
          )}

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

          <div className={`warehouse-orders-mobile-list${canEdit ? ' warehouse-orders-mobile-list--fab' : ''}`}>
            {loading && docs.length === 0 ? (
              <div className="warehouse-orders-mobile-empty">Загрузка...</div>
            ) : docs.length === 0 ? (
              <div className="warehouse-orders-mobile-empty">Приходов пока нет</div>
            ) : (
              docs.map((doc) => (
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
                  <div className="warehouse-orders-mobile-card-meta">
                    <span>{formatDate(doc.date)}</span>
                    {doc.to_department_name && <span>{doc.to_department_name}</span>}
                  </div>
                  <div className="warehouse-orders-mobile-card-client">
                    {doc.counterparty_name || 'Без поставщика'}
                  </div>
                  <div className="warehouse-orders-mobile-card-bottom">
                    <span>Приход</span>
                    <strong>{formatMoney(doc.total_amount)}</strong>
                  </div>
                </button>
              ))
            )}
          </div>

          {canEdit && (
            <button type="button" className="warehouse-prihod-fab" onClick={openCreate}>
              + Приход
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
            <h2>Новый приход</h2>
            <button
              type="button"
              className="warehouse-orders-mobile-icon-btn warehouse-orders-mobile-detail-theme"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
            </button>
          </header>

          <div className="warehouse-orders-mobile-detail-body warehouse-prihod-form">
            {canSwitchBranch ? (
              <label className="warehouse-prihod-field">
                <span>Филиал</span>
                <select
                  value={branchId || ''}
                  onChange={(e) => setActiveBranchId(e.target.value)}
                  aria-label="Выбор филиала"
                >
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="warehouse-prihod-field">
                <span>Филиал</span>
                <div className="warehouse-prihod-readonly">{branchName}</div>
              </div>
            )}

            <label className="warehouse-prihod-field">
              <span>Поставщик</span>
              <select
                value={form.counterparty_id}
                onChange={(e) => setSupplier(e.target.value)}
              >
                <option value="">Выберите…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>

            <label className="warehouse-prihod-field">
              <span>Отдел приёмки</span>
              <select
                value={form.to_department_id}
                onChange={(e) => setForm((prev) => ({ ...prev, to_department_id: e.target.value }))}
              >
                <option value="">Выберите…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>

            <label className="warehouse-prihod-field">
              <span>Дата</span>
              <input
                type="date"
                value={form.date || todayLocalIso()}
                onChange={(e) => setForm((prev) => ({
                  ...prev,
                  date: e.target.value || todayLocalIso(),
                }))}
              />
            </label>

            <div className="warehouse-prihod-items-head">
              <h3>Позиции</h3>
              <button type="button" className="btn btn-sm btn-ghost" onClick={addItem}>
                + Товар
              </button>
            </div>

            {!form.counterparty_id && (
              <p className="warehouse-prihod-hint">Сначала выберите поставщика — появится список его товаров.</p>
            )}

            {form.items.map((item, idx) => (
              <div key={idx} className="warehouse-prihod-item">
                <label className="warehouse-prihod-field">
                  <span>Товар</span>
                  <select
                    value={encodeProductPick(item.product_id, item.variant_id)}
                    onChange={(e) => onProductPick(idx, e.target.value)}
                    disabled={!form.counterparty_id}
                  >
                    <option value="">Выберите…</option>
                    {productOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                <div className="warehouse-prihod-item-row">
                  <label className="warehouse-prihod-field">
                    <span>Кол-во</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, { quantity: normalizeQuantityInput(e.target.value) })}
                    />
                  </label>
                  <label className="warehouse-prihod-field">
                    <span>Нетто</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.net_weight ?? ''}
                      placeholder="на 1 шт"
                      onChange={(e) => updateItem(idx, { net_weight: normalizeQuantityInput(e.target.value) })}
                    />
                  </label>
                  <label className="warehouse-prihod-field">
                    <span>Цена</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatPriceInput(item.price)}
                      onChange={(e) => updateItem(idx, { price: formatPriceInput(e.target.value) })}
                    />
                  </label>
                  <label className="warehouse-prihod-field">
                    <span>Сумма</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.amount_input ?? formatPriceInput(lineMoneyFromItem(item).amount)}
                      onChange={(e) => updateItemAmount(idx, e.target.value)}
                    />
                  </label>
                </div>
                {extraAllocations[idx] > 0 && (
                  <p className="warehouse-prihod-hint">
                    С доставкой: {formatMoney(lineMoneyFromItem(item).amount + extraAllocations[idx])}
                  </p>
                )}
                {(() => {
                  const net = Number(item.net_weight) || 0;
                  const qty = parseQuantityInput(item.quantity) ?? 0;
                  if (!(net > 0 && qty > 0)) return null;
                  return (
                    <p className="warehouse-prihod-hint">
                      На склад: {net * qty}
                    </p>
                  );
                })()}
                {form.items.length > 1 && (
                  <button type="button" className="warehouse-prihod-item-remove" onClick={() => removeItem(idx)}>
                    Удалить строку
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="warehouse-prihod-extras">
            <div className="warehouse-prihod-items-head">
              <h3>Доп. расходы</h3>
              <button type="button" className="btn btn-ghost" onClick={addExtraCost}>+ Расход</button>
            </div>
            {(form.extra_costs || []).map((row, idx) => (
              <div key={idx} className="warehouse-prihod-item">
                <label className="warehouse-prihod-field">
                  <span>Название</span>
                  <input
                    type="text"
                    placeholder="Дорога…"
                    value={row.title}
                    onChange={(e) => updateExtraCost(idx, { title: e.target.value })}
                  />
                </label>
                <div className="warehouse-prihod-item-row">
                  <label className="warehouse-prihod-field">
                    <span>Сумма</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatPriceInput(row.amount)}
                      onChange={(e) => updateExtraCost(idx, { amount: formatPriceInput(e.target.value) })}
                    />
                  </label>
                  <label className="warehouse-prihod-field">
                    <span>Учёт</span>
                    <select
                      value={row.capitalize === false ? 'period' : 'cost'}
                      onChange={(e) => updateExtraCost(idx, { capitalize: e.target.value !== 'period' })}
                    >
                      <option value="cost">В себестоимость</option>
                      <option value="period">В расходы</option>
                    </select>
                  </label>
                </div>
                <button type="button" className="warehouse-prihod-item-remove" onClick={() => removeExtraCost(idx)}>
                  Удалить расход
                </button>
              </div>
            ))}
            {(form.extra_costs || []).some((e) => e.capitalize !== false) && (
              <p className="warehouse-prihod-hint">
                В себестоимость: кассу платите отдельно статьёй «Закуп».
              </p>
            )}
          </div>

          <div className="warehouse-prihod-footer">
            <div className="warehouse-orders-mobile-detail-total">
              <span>Товары</span>
              <strong>{formatMoney(formTotal)}</strong>
            </div>
            {extrasTotal > 0 && (
              <div className="warehouse-orders-mobile-detail-total">
                <span>Доп. расходы</span>
                <strong>{formatMoney(extrasTotal)}</strong>
              </div>
            )}
            <div className="warehouse-orders-mobile-detail-total">
              <span>На склад</span>
              <strong>{formatMoney(formTotal + extrasCapitalized)}</strong>
            </div>
            <button
              type="button"
              className="btn btn-success btn-block"
              disabled={saving}
              onClick={() => submit('confirmed')}
            >
              {saving ? 'Сохранение…' : 'Провести'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              disabled={saving}
              onClick={() => submit('draft')}
            >
              Черновик
            </button>
          </div>
        </div>
      )}

      {view === 'detail' && selected && (
        <div className="warehouse-orders-mobile-detail">
          <header className="warehouse-orders-mobile-detail-header">
            <button type="button" className="warehouse-orders-mobile-back" onClick={closeToList}>
              ← Назад
            </button>
            <h2>Приход №{selected.number}</h2>
            <button
              type="button"
              className="warehouse-orders-mobile-icon-btn warehouse-orders-mobile-detail-theme"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
            </button>
          </header>

          <div className="warehouse-orders-mobile-detail-body">
            <div className="warehouse-orders-mobile-detail-total">
              <span>Товары</span>
              <strong>{formatMoney(selected.total_amount)}</strong>
            </div>
            {(selected.extra_costs_total || 0) > 0 && (
              <div className="warehouse-orders-mobile-detail-total">
                <span>Доп. расходы</span>
                <strong>{formatMoney(selected.extra_costs_total)}</strong>
              </div>
            )}
            {(selected.capitalized_extra_total || 0) > 0 && (
              <div className="warehouse-orders-mobile-detail-total">
                <span>На склад</span>
                <strong>{formatMoney(selected.landed_total)}</strong>
              </div>
            )}

            <div className="shop-order-detail-grid warehouse-orders-mobile-detail-grid">
              <div>
                <span>Статус</span>
                <strong>
                  <span className={statusClass(selected.status)}>
                    {STATUS_LABELS[selected.status] || selected.status}
                  </span>
                </strong>
              </div>
              <div><span>Дата</span><strong>{formatDate(selected.date)}</strong></div>
              <div><span>Поставщик</span><strong>{selected.counterparty_name || '—'}</strong></div>
              {selected.to_department_name && (
                <div><span>Отдел</span><strong>{selected.to_department_name}</strong></div>
              )}
              {selected.comment && (
                <div className="shop-order-detail-wide"><span>Комментарий</span><strong>{selected.comment}</strong></div>
              )}
            </div>

            <div className="shop-order-items warehouse-orders-mobile-items">
              <h3>Товары</h3>
              <ul>
                {(selected.items || []).map((item) => (
                  <li key={item.id || `${item.product_id}-${item.variant_id}`}>
                    <div className="shop-order-item-main">
                      <strong>{item.product_name || item.name}</strong>
                      {item.variant_name && <span className="muted"> — {item.variant_name}</span>}
                    </div>
                    <div className="shop-order-item-meta">
                      {item.quantity} × {formatMoney(item.price)}
                      <strong>{formatMoney((Number(item.quantity) || 0) * (Number(item.price) || 0))}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {(selected.extra_costs || []).length > 0 && (
              <div className="shop-order-items warehouse-orders-mobile-items">
                <h3>Доп. расходы</h3>
                <ul>
                  {selected.extra_costs.map((row) => (
                    <li key={row.id || row.title}>
                      <div className="shop-order-item-main">
                        <strong>{row.title}</strong>
                        <span className="muted">
                          {' '}
                          {row.capitalize ? 'в себестоимость' : 'в расходы'}
                        </span>
                      </div>
                      <div className="shop-order-item-meta">
                        <strong>{formatMoney(row.amount)}</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {selected.status === 'draft' && canConfirm && (
            <div className="warehouse-prihod-footer">
              <button
                type="button"
                className="btn btn-success btn-block"
                disabled={saving}
                onClick={confirmSelected}
              >
                {saving ? 'Проведение…' : 'Провести'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
