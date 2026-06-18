import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatPriceInput, parsePriceInput } from '../api';
import Modal, { useToast } from '../components/Modal';
import ProductSelect from '../components/ProductSelect';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { hasPermission } from '../permissions';
import { AddRowButton } from '../components/ActionIcons';
import {
  encodeProductPick,
  resolvePickFromProducts,
} from '../utils/productVariants';

const emptyLine = { product_id: '', variant_id: null, quantity: 0, price: 0 };
const emptySourceLine = { product_id: '', variant_id: null, quantity: 1 };
const emptyForm = {
  name: '',
  source_product_id: '',
  base_quantity: 1,
  active: true,
  comment: '',
  sources: [{ ...emptySourceLine }],
  items: [{ ...emptyLine }],
};

export default function Calculations() {
  const [list, setList] = useState([]);
  const [products, setProducts] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchId } = useBranch();
  const navigate = useNavigate();
  const canEdit = hasPermission(user, 'calculations.edit');

  const load = () => {
    api.getCalculations().then(setList).catch(console.error);
  };

  useEffect(() => { load(); }, [branchId]);
  useEffect(() => {
    api.getProducts().then(setProducts).catch(console.error);
  }, [branchId]);

  const sourceProductKeys = useMemo(
    () => new Set(
      form.sources
        .filter((s) => s.product_id)
        .map((s) => encodeProductPick(s.product_id, s.variant_id)),
    ),
    [form.sources],
  );

  const outputProducts = useMemo(
    () => products,
    [products],
  );

  const inputProductsForCalc = useMemo(
    () => products,
    [products],
  );

  const openCreate = () => {
    setForm({ ...emptyForm, sources: [{ ...emptySourceLine }], items: [{ ...emptyLine }] });
    setModal('create');
  };

  const openEdit = async (id) => {
    const calc = await api.getCalculation(id);
    setForm({
      id: calc.id,
      name: calc.name,
      source_product_id: calc.source_product_id,
      base_quantity: calc.base_quantity || 1,
      active: !!calc.active,
      comment: calc.comment || '',
      sources: (calc.sources?.length ? calc.sources : [{
        product_id: calc.source_product_id,
        variant_id: calc.source_variant_id || null,
        quantity: calc.base_quantity || 1,
      }]).map((s) => ({
        product_id: s.product_id,
        variant_id: s.variant_id || null,
        quantity: s.quantity,
      })),
      items: calc.items.length
        ? calc.items.map((i) => ({
          product_id: i.product_id,
          variant_id: i.variant_id || null,
          quantity: i.quantity,
          price: i.price || 0,
          is_waste: !!i.is_waste,
        }))
        : [{ ...emptyLine }],
    });
    setModal('edit');
  };

  const updateSourcePick = (idx, pickValue) => {
    const resolved = resolvePickFromProducts(products, pickValue);
    const sources = [...form.sources];
    sources[idx] = {
      ...sources[idx],
      product_id: resolved.productId,
      variant_id: resolved.variantId,
    };
    const next = { ...form, sources };
    if (idx === 0) {
      next.source_product_id = resolved.productId;
    }
    setForm(next);
  };

  const updateSource = (idx, field, value) => {
    const sources = [...form.sources];
    sources[idx] = { ...sources[idx], [field]: value };
    const next = { ...form, sources };
    if (idx === 0 && field === 'product_id') {
      next.source_product_id = value;
    }
    if (idx === 0 && field === 'quantity') {
      next.base_quantity = value;
    }
    setForm(next);
  };

  const addSource = () => setForm({ ...form, sources: [...form.sources, { ...emptySourceLine }] });

  const removeSource = (idx) => {
    if (form.sources.length <= 1) return;
    setForm({ ...form, sources: form.sources.filter((_, i) => i !== idx) });
  };

  const updateItemPick = (idx, pickValue) => {
    const resolved = resolvePickFromProducts(products, pickValue);
    const pickKey = encodeProductPick(resolved.productId, resolved.variantId);
    if (sourceProductKeys.has(pickKey)) {
      show('Эта позиция уже указана во входе', 'error');
      return;
    }
    const items = [...form.items];
    items[idx] = {
      ...items[idx],
      product_id: resolved.productId,
      variant_id: resolved.variantId,
    };
    setForm({ ...form, items });
  };

  const updateItem = (idx, field, value) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: value };
    setForm({ ...form, items });
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyLine }] });

  const removeItem = (idx) => {
    if (form.items.length <= 1) return;
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  };

  const save = async () => {
    try {
      if (!form.name.trim()) {
        show('Укажите название', 'error');
        return;
      }
      const sources = form.sources.filter((s) => s.product_id && s.quantity > 0);
      if (sources.length === 0) {
        show('Добавьте сырьё (вход)', 'error');
        return;
      }
      const items = form.items.filter((i) => i.product_id);
      if (items.length === 0) {
        show('Добавьте выходные товары', 'error');
        return;
      }
      const duplicateOutput = items.find((i) =>
        sourceProductKeys.has(encodeProductPick(i.product_id, i.variant_id)));
      if (duplicateOutput) {
        show('Выходная позиция не может совпадать с входом', 'error');
        return;
      }

      const payload = {
        name: form.name.trim(),
        source_product_id: sources[0].product_id,
        source_variant_id: sources[0].variant_id || null,
        base_quantity: sources[0].quantity || 1,
        active: form.active,
        comment: form.comment || '',
        sources: sources.map((s) => ({
          product_id: s.product_id,
          variant_id: s.variant_id || null,
          quantity: s.quantity,
        })),
        items: items.map((i) => ({
          product_id: i.product_id,
          variant_id: i.variant_id || null,
          quantity: Number(i.quantity) || 0,
          price: i.price || 0,
          is_waste: !!i.is_waste,
        })),
      };

      if (modal === 'create') {
        await api.createCalculation(payload);
        show('Калькуляция создана');
      } else {
        await api.updateCalculation(form.id, payload);
        show('Калькуляция обновлена');
      }
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (calc) => {
    if (!window.confirm(`Удалить калькуляцию «${calc.name}»?`)) return;
    try {
      await api.deleteCalculation(calc.id);
      show('Калькуляция удалена');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const goToRazdelka = async (calc) => {
    try {
      const full = await api.getCalculation(calc.id);
      const result = await api.applyCalculation(calc.id, {
        input_quantity: full.base_quantity || 1,
        input_price: full.source_catalog_price || 0,
      });
      sessionStorage.setItem('razdelka_prefill', JSON.stringify(result));
      navigate('/razdelka');
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Калькуляции</h1>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>+ Новая калькуляция</button>
        )}
      </div>

      <p className="page-hint">
        Шаблон разделки: укажите сырьё и список выходных товаров.
        Количество в выходе необязательно — фактические кг вводятся в разделке. Отметьте «Отход» для позиций без стоимости.
      </p>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Сырьё</th>
                <th>База</th>
                <th>Выход</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.source_product_name}</td>
                  <td>{c.base_quantity} {c.source_unit || 'шт'}</td>
                  <td>{c.output_count} поз.</td>
                  <td>
                    <span className={`badge badge-${c.active ? 'confirmed' : 'cancelled'}`}>
                      {c.active ? 'Активна' : 'Отключена'}
                    </span>
                  </td>
                  <td>
                    <div className="btn-group">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => openEdit(c.id)}>Открыть</button>
                      {hasPermission(user, 'documents.razdelka') && c.active && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => goToRazdelka(c)}
                        >
                          Разделка
                        </button>
                      )}
                      {canEdit && (
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(c)}>Удалить</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={6} className="empty">Калькуляции не созданы</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          className="modal-doc modal-calc"
          title={modal === 'create' ? 'Новая калькуляция' : 'Редактирование калькуляции'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Отмена</button>
              {canEdit && <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>}
            </>
          }
        >
          <div className="calc-modal">
            <div className="calc-modal-top">
              <div className="form-group calc-field-name">
                <label>Название *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={!canEdit}
                  placeholder="Например: Qo'y son"
                />
              </div>
              <div className="form-group calc-field-base">
                <label>База (1-я позиция)</label>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={form.sources[0]?.quantity || form.base_quantity}
                  disabled={!canEdit}
                  onChange={(e) => updateSource(0, 'quantity', +e.target.value)}
                />
              </div>
              <div className="form-group calc-field-status">
                <label>Статус</label>
                <select
                  value={form.active ? '1' : '0'}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}
                >
                  <option value="1">Активна</option>
                  <option value="0">Отключена</option>
                </select>
              </div>
              <div className="form-group calc-field-comment">
                <label>Комментарий</label>
                <input
                  type="text"
                  value={form.comment}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, comment: e.target.value })}
                  placeholder="Необязательно"
                />
              </div>
            </div>

            <div className="calc-modal-panels">
              <section className="calc-panel calc-panel-in">
                <div className="doc-modal-items-header">
                  <h3>Вход — сырьё</h3>
                  {canEdit && <AddRowButton onClick={addSource} />}
                </div>
                <div className="table-wrap items-table doc-items-table calc-source-table doc-modal-items-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Товар</th>
                        <th className="col-num">Кол-во</th>
                        <th className="doc-items-actions-col"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.sources.map((source, idx) => (
                        <tr key={`src-${idx}`}>
                          <td>
                            <ProductSelect
                              products={inputProductsForCalc}
                              value={encodeProductPick(source.product_id, source.variant_id)}
                              onChange={(pickValue) => updateSourcePick(idx, pickValue)}
                              disabled={!canEdit}
                              placeholder="Выберите сырьё..."
                            />
                          </td>
                          <td className="col-num">
                            <input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={source.quantity}
                              disabled={!canEdit}
                              onChange={(e) => updateSource(idx, 'quantity', +e.target.value)}
                            />
                          </td>
                          <td className="doc-items-actions-col">
                            {canEdit && form.sources.length > 1 && (
                              <button
                                type="button"
                                className="btn btn-sm btn-danger doc-items-row-actions"
                                onClick={() => removeSource(idx)}
                                title="Удалить строку"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="calc-panel calc-panel-out">
                <div className="doc-modal-items-header">
                  <h3>Выход — продукция</h3>
                  {canEdit && <AddRowButton onClick={addItem} />}
                </div>
                <div className="table-wrap items-table doc-items-table calc-items-table doc-modal-items-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Товар</th>
                        <th className="col-num" title="Необязательно — кг вводятся при разделке">Доля, кг</th>
                        <th className="col-num" title="0 или пусто — авто из сырья">Цена</th>
                        <th className="col-waste">Отход</th>
                        <th className="doc-items-actions-col"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.map((item, idx) => (
                        <tr key={idx} className={item.is_waste ? 'calc-row-waste' : ''}>
                          <td>
                            <ProductSelect
                              products={outputProducts}
                              allProducts={products}
                              value={encodeProductPick(item.product_id, item.variant_id)}
                              onChange={(pickValue) => updateItemPick(idx, pickValue)}
                              disabled={!canEdit}
                              placeholder="Продукция..."
                            />
                          </td>
                          <td className="col-num">
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={item.quantity || ''}
                              placeholder="—"
                              disabled={!canEdit}
                              onChange={(e) => updateItem(idx, 'quantity', +e.target.value)}
                            />
                          </td>
                          <td className="col-num">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={item.price ? formatPriceInput(item.price) : ''}
                              placeholder="Авто"
                              disabled={!canEdit || item.is_waste}
                              onChange={(e) => updateItem(idx, 'price', parsePriceInput(e.target.value) || 0)}
                            />
                          </td>
                          <td className="col-waste">
                            <label className="calc-waste-toggle" title="Без стоимости (отход)">
                              <input
                                type="checkbox"
                                checked={!!item.is_waste}
                                disabled={!canEdit}
                                onChange={(e) => updateItem(idx, 'is_waste', e.target.checked)}
                              />
                            </label>
                          </td>
                          <td className="doc-items-actions-col">
                            {canEdit && form.items.length > 1 && (
                              <button
                                type="button"
                                className="btn btn-sm btn-danger doc-items-row-actions"
                                onClick={() => removeItem(idx)}
                                title="Удалить строку"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="calc-panel-hint">
                  Долю можно не указывать — фактический вес вводится в разделке. Отметьте «Отход» для позиций без стоимости.
                </p>
              </section>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
