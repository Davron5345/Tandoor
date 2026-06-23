import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatMoney, formatDate, STATUS_LABELS, normalizeQuantityInput, parseQuantityInput } from '../api';
import Modal, { useToast } from '../components/Modal';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { hasPermission } from '../permissions';
import { AddRowButton, IconCheck, IconEye, IconTrash, IconUndo } from '../components/ActionIcons';
import { encodeProductPick } from '../utils/productVariants';

const emptyLine = { product_id: '', variant_id: null, quantity: 1, price: 0, calculation_id: '' };

const emptyForm = {
  type: 'dish_sale',
  date: new Date().toISOString().slice(0, 10),
  counterparty_id: '',
  from_department_id: '',
  comment: '',
  status: 'draft',
  items: [{ ...emptyLine }],
};

function linePick(line) {
  return encodeProductPick(line.product_id, line.variant_id);
}

export default function DishSales() {
  const [docs, setDocs] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [clients, setClients] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [lineCosts, setLineCosts] = useState({});
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchId } = useBranch();
  const canEdit = hasPermission(user, 'documents.edit');
  const canConfirm = hasPermission(user, 'documents.confirm');

  const dishOptions = useMemo(() => recipes.flatMap((recipe) =>
    (recipe.dishes || []).map((dish) => ({
      ...dish,
      recipe_id: recipe.id,
      recipe_name: recipe.name,
      pick: encodeProductPick(dish.product_id, dish.variant_id),
    })),
  ), [recipes]);

  const dishByPick = useMemo(() => {
    const map = new Map();
    dishOptions.forEach((d) => map.set(d.pick, d));
    return map;
  }, [dishOptions]);

  const load = useCallback(() => {
    const params = { type: 'dish_sale' };
    if (filterStatus) params.status = filterStatus;
    api.getDocuments(params).then(setDocs).catch(console.error);
  }, [filterStatus, branchId]);

  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(load, [load, branchId], { enabled: !modal });

  useEffect(() => {
    Promise.all([
      api.getDishRecipes(),
      api.getCounterparties({ type: 'client' }),
      api.getDepartments({ active: '1' }),
    ]).then(([r, c, d]) => {
      setRecipes(r);
      setClients(c);
      setDepartments(d.filter((dep) => dep.branch_id === (branchId || 'main')));
    }).catch(console.error);
  }, [branchId]);

  const refreshLineCost = async (index, nextForm = form) => {
    const line = nextForm.items[index];
    if (!line?.product_id || !nextForm.from_department_id || !line.quantity) {
      setLineCosts((prev) => ({ ...prev, [index]: null }));
      return;
    }
    try {
      const preview = await api.previewDishSale({
        product_id: line.product_id,
        variant_id: line.variant_id,
        quantity: line.quantity,
        department_id: nextForm.from_department_id,
        calculation_id: line.calculation_id || undefined,
      });
      setLineCosts((prev) => ({ ...prev, [index]: preview }));
    } catch {
      setLineCosts((prev) => ({ ...prev, [index]: null }));
    }
  };

  const openCreate = () => {
    setForm({
      ...emptyForm,
      from_department_id: departments[0]?.id || '',
      items: [{ ...emptyLine }],
    });
    setLineCosts({});
    setModal('create');
  };

  const openEdit = async (id) => {
    const doc = await api.getDocument(id);
    setForm({
      type: 'dish_sale',
      id: doc.id,
      date: doc.date,
      counterparty_id: doc.counterparty_id || '',
      from_department_id: doc.from_department_id || '',
      comment: doc.comment || '',
      status: doc.status,
      items: (doc.items?.length ? doc.items : doc.sale_items || []).map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        quantity: item.quantity,
        price: item.price,
        calculation_id: '',
      })),
    });
    setLineCosts({});
    setModal('edit');
  };

  useEffect(() => {
    if (!modal) return;
    form.items.forEach((_, idx) => { refreshLineCost(idx); });
  }, [modal, form.from_department_id]);

  const setLine = (index, patch) => {
    setForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], ...patch };
      return { ...prev, items };
    });
  };

  const onDishPick = (index, pick) => {
    const dish = dishByPick.get(pick);
    if (!dish) {
      setLine(index, { product_id: '', variant_id: null, calculation_id: '', price: 0 });
      return;
    }
    setLine(index, {
      product_id: dish.product_id,
      variant_id: dish.variant_id || null,
      calculation_id: dish.recipe_id,
      price: Number(dish.price) || 0,
    });
    setTimeout(() => refreshLineCost(index), 0);
  };

  const addLine = () => setForm((prev) => ({ ...prev, items: [...prev.items, { ...emptyLine }] }));

  const removeLine = (index) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== index) : prev.items,
    }));
  };

  const totalRevenue = form.items.reduce(
    (s, line) => s + (parseQuantityInput(line.quantity) ?? 0) * (Number(line.price) || 0),
    0,
  );
  const totalCost = Object.values(lineCosts).reduce((s, row) => s + (row?.total_cost || 0), 0);

  const save = async (confirm) => {
    if (!form.from_department_id) {
      show('Выберите склад списания ингредиентов', 'error');
      return;
    }
    if (!form.items.some((line) => line.product_id && (parseQuantityInput(line.quantity) ?? 0) > 0)) {
      show('Добавьте хотя бы одно блюдо', 'error');
      return;
    }
    const payload = {
      type: 'dish_sale',
      date: form.date,
      counterparty_id: form.counterparty_id || null,
      from_department_id: form.from_department_id,
      comment: form.comment,
      status: confirm ? 'confirmed' : 'draft',
      items: form.items.filter((line) => line.product_id).map((line) => ({
        product_id: line.product_id,
        variant_id: line.variant_id,
        quantity: parseQuantityInput(line.quantity) ?? 0,
        price: Number(line.price),
        calculation_id: line.calculation_id || undefined,
      })),
    };
    try {
      if (modal === 'create') {
        await api.createDocument(payload);
        show(confirm ? 'Продажа проведена' : 'Документ сохранён');
      } else {
        await api.updateDocument(form.id, payload);
        show(confirm ? 'Продажа проведена' : 'Документ обновлён');
      }
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const confirmDoc = async (id) => {
    try {
      await api.confirmDocument(id);
      show('Продажа проведена');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const cancelDoc = async (id) => {
    if (!window.confirm('Отменить документ?')) return;
    try {
      await api.cancelDocument(id);
      show('Документ отменён');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const isReadOnly = !canEdit || (form.status === 'confirmed' && modal === 'edit');

  return (
    <div>
      {Toast}
      <div className="page-header">
        <div>
          <h1>Продажа блюд</h1>
          <p className="page-subtitle">Выручка по блюдам, списание ингредиентов по рецепту</p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate} disabled={dishOptions.length === 0}>
            + Продажа
          </button>
        )}
      </div>

      {dishOptions.length === 0 && (
        <div className="alert">
          Сначала создайте рецепт блюда в разделе «Калькуляции» (тип «Рецепт блюда»).
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="draft">Черновик</option>
          <option value="confirmed">Проведён</option>
          <option value="cancelled">Отменён</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Клиент</th>
                <th>Склад</th>
                <th className="col-num">Сумма</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.number}</td>
                  <td>{formatDate(d.date)}</td>
                  <td>{d.counterparty_name || '—'}</td>
                  <td>{d.from_department_name || '—'}</td>
                  <td className="col-num">{formatMoney(d.total_amount)}</td>
                  <td><span className={`badge badge-${d.status}`}>{STATUS_LABELS[d.status] || d.status}</span></td>
                  <td>
                    <div className="btn-group">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => openEdit(d.id)} title="Открыть">
                        <IconEye />
                      </button>
                      {canConfirm && d.status === 'draft' && (
                        <button type="button" className="btn btn-sm btn-success" onClick={() => confirmDoc(d.id)} title="Провести">
                          <IconCheck />
                        </button>
                      )}
                      {canEdit && d.status !== 'cancelled' && (
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => cancelDoc(d.id)} title="Отменить">
                          <IconUndo />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr><td colSpan={7} className="empty">Продаж блюд пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          className="modal-doc"
          title={modal === 'create' ? 'Продажа блюд' : `Продажа №${form.number || ''}`}
          onClose={() => setModal(null)}
          wide
          footer={
            !isReadOnly && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => save(false)}>Сохранить</button>
                {canConfirm && (
                  <button type="button" className="btn btn-success" onClick={() => save(true)}>Провести</button>
                )}
              </>
            )
          }
        >
          <div className="doc-modal">
            <div className="doc-modal-fields">
              <label>
                Дата
                <input type="date" value={form.date} disabled={isReadOnly} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <label>
                Клиент
                <select value={form.counterparty_id} disabled={isReadOnly} onChange={(e) => setForm({ ...form, counterparty_id: e.target.value })}>
                  <option value="">Без клиента</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>
                Склад ингредиентов
                <select
                  value={form.from_department_id}
                  disabled={isReadOnly}
                  onChange={(e) => setForm({ ...form, from_department_id: e.target.value })}
                >
                  <option value="">Выберите склад</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="full-width">
                Комментарий
                <input type="text" value={form.comment} disabled={isReadOnly} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
              </label>
            </div>

            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Блюдо</th>
                    <th className="col-num">Кол-во</th>
                    <th className="col-num">Цена</th>
                    <th className="col-num">Сумма</th>
                    <th className="col-num">Себест.</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((line, index) => {
                    const amount = (parseQuantityInput(line.quantity) ?? 0) * (Number(line.price) || 0);
                    const cost = lineCosts[index];
                    return (
                      <tr key={index}>
                        <td>
                          <select
                            value={linePick(line)}
                            disabled={isReadOnly}
                            onChange={(e) => onDishPick(index, e.target.value)}
                          >
                            <option value="">Выберите блюдо</option>
                            {dishOptions.map((dish) => (
                              <option key={`${dish.recipe_id}:${dish.pick}`} value={dish.pick}>
                                {dish.display_name} · {dish.recipe_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="col-num"
                            disabled={isReadOnly}
                            value={line.quantity}
                            onChange={(e) => {
                              setLine(index, { quantity: normalizeQuantityInput(e.target.value) });
                              setTimeout(() => refreshLineCost(index), 0);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="col-num"
                            disabled={isReadOnly}
                            value={line.price}
                            onChange={(e) => setLine(index, { price: e.target.value })}
                          />
                        </td>
                        <td className="col-num">{formatMoney(amount)}</td>
                        <td className="col-num">
                          {cost ? (
                            <span title={cost.calculation_name}>{formatMoney(cost.total_cost)}</span>
                          ) : '—'}
                        </td>
                        <td>
                          {!isReadOnly && form.items.length > 1 && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLine(index)}>
                              <IconTrash />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!isReadOnly && <AddRowButton onClick={addLine}>Добавить блюдо</AddRowButton>}

            <div className="doc-modal-total" style={{ marginTop: 16 }}>
              <strong>Выручка: {formatMoney(totalRevenue)}</strong>
              {totalCost > 0 && (
                <span className="stock-kpi-hint" style={{ marginLeft: 12 }}>
                  Себестоимость: {formatMoney(totalCost)} · Маржа: {formatMoney(totalRevenue - totalCost)}
                </span>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
