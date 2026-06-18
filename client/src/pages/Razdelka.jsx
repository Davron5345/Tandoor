import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatMoney, formatDate, STATUS_LABELS, ACTION_LABELS } from '../api';
import Modal, { useToast } from '../components/Modal';
import ProductSelect from '../components/ProductSelect';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { hasPermission } from '../permissions';
import {
  IconButton,
  IconCheck,
  IconEye,
  IconHistory,
  AddRowButton,
  IconTrash,
  IconUndo,
} from '../components/ActionIcons';

import {
  encodeProductPick,
  resolvePickFromProducts,
  getPickPrice,
  getPickStock,
  getPickDisplayName,
} from '../utils/productVariants';

const emptyLine = { product_id: '', variant_id: null, price: 0, outputs: {} };

function colLineKey(col) {
  return encodeProductPick(col.product_id, col.variant_id);
}

function colDisplayName(col) {
  return col.display_name || col.product_name;
}

function initRowOutputs(row, calcItems = []) {
  const outputs = { ...(row.outputs || {}) };
  calcItems.forEach((item) => {
    const key = encodeProductPick(item.product_id, item.variant_id);
    if (outputs[key] == null && outputs[item.product_id] != null && !item.variant_id) {
      outputs[key] = outputs[item.product_id];
    }
    if (outputs[key] == null) outputs[key] = 0;
  });
  return { ...row, outputs };
}

function getProcessedWeight(item, calcItems = []) {
  if (item.outputs && typeof item.outputs === 'object') {
    return Object.values(item.outputs).reduce((s, v) => s + (Number(v) || 0), 0);
  }
  return (Number(item?.toza) || 0) + (Number(item?.qiymali) || 0) + (Number(item?.otkhod) || 0);
}

function calcRazdelkaPricing(inputItems, resolveProduct, outputColumns, { draft = true } = {}) {
  let inputTotal = 0;

  for (const item of inputItems) {
    if (!item.product_id) continue;
    const product = resolveProduct(item);
    if (!product) continue;
    const unitPrice = Number(item.price) || Number(product.price) || 0;
    const rowWeight = getProcessedWeight(item, outputColumns);
    const basisWeight = rowWeight > 0
      ? rowWeight
      : (draft && product.stock != null ? Number(product.stock) : Number(item.quantity) || 0);
    inputTotal += basisWeight * unitPrice;
  }

  const outputTotals = {};
  outputColumns.forEach((col) => {
    const key = colLineKey(col);
    outputTotals[key] = inputItems.reduce(
      (s, item) => s + (Number(item.outputs?.[key]) || 0),
      0,
    );
  });

  const sellableWeight = outputColumns
    .filter((col) => !col.is_waste)
    .reduce((s, col) => s + (outputTotals[colLineKey(col)] || 0), 0);
  const unitPrice = sellableWeight > 0 ? inputTotal / sellableWeight : 0;

  const outputAmounts = {};
  outputColumns.forEach((col) => {
    const key = colLineKey(col);
    const qty = outputTotals[key] || 0;
    outputAmounts[key] = col.is_waste ? 0 : qty * unitPrice;
  });

  return {
    inputTotal,
    unitPrice,
    outputTotals,
    outputAmounts,
    sellableWeight,
  };
}

const emptyForm = {
  type: 'razdelka',
  from_department_id: '',
  to_department_id: 'main_wh',
  date: new Date().toISOString().slice(0, 10),
  comment: '',
  status: 'draft',
  input_items: [{ ...emptyLine }],
};

function mapDocToInputItems(doc, calcItems = []) {
  const inputs = (doc.input_items?.length ? doc.input_items : doc.items || [])
    .filter((i) => (i.item_role || 'input') === 'input' || !i.item_role);
  const outputs = doc.output_items || [];

  const outputsMap = {};
  outputs.forEach((o) => {
    const qty = o.quantity || o.toza || o.qiymali || o.otkhod || 0;
    if (qty > 0) outputsMap[encodeProductPick(o.product_id, o.variant_id)] = qty;
  });

  if (inputs.some((i) => i.outputs && Object.keys(i.outputs).length)) {
    return inputs.map((i) => initRowOutputs({
      product_id: i.product_id,
      variant_id: i.variant_id || null,
      quantity: i.quantity,
      price: i.price,
      outputs: i.outputs,
    }, calcItems));
  }

  if (inputs.length === 0) return [initRowOutputs({ ...emptyLine }, calcItems)];

  if (Object.keys(outputsMap).length > 0) {
    return inputs.map((i) => initRowOutputs({
      product_id: i.product_id,
      variant_id: i.variant_id || null,
      quantity: i.quantity,
      price: i.price,
      outputs: outputsMap,
    }, calcItems));
  }

  const first = inputs[0];
  return [initRowOutputs({
    product_id: first.product_id,
    variant_id: first.variant_id || null,
    quantity: first.quantity,
    price: first.price,
    outputs: {},
  }, calcItems)];
}


export default function Razdelka() {
  const [docs, setDocs] = useState([]);
  const [products, setProducts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [modal, setModal] = useState(null);
  const [historyModal, setHistoryModal] = useState(null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [inputProducts, setInputProducts] = useState([]);
  const [calculations, setCalculations] = useState([]);
  const [selectedCalcId, setSelectedCalcId] = useState('');
  const [activeCalc, setActiveCalc] = useState(null);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchId } = useBranch();
  const canEdit = hasPermission(user, 'documents.edit');
  const canConfirm = hasPermission(user, 'documents.confirm');
  const canDelete = hasPermission(user, 'documents.delete');
  const isReadOnly = !canEdit;

  const branchDepartments = departments.filter((d) => d.active && d.branch_id === (branchId || 'main'));

  const load = () => {
    const params = { type: 'razdelka' };
    if (filterStatus) params.status = filterStatus;
    api.getDocuments(params).then(setDocs).catch(console.error);
  };

  useEffect(() => { load(); }, [filterStatus, branchId]);

  useEffect(() => {
    Promise.all([
      api.getProducts(),
      api.getDepartments({ active: '1' }),
      hasPermission(user, 'calculations.view') ? api.getCalculations({ active: '1' }) : Promise.resolve([]),
    ]).then(([p, d, c]) => {
      setProducts(p);
      setDepartments(d);
      setCalculations(c);
    }).catch(console.error);
  }, [branchId, user]);

  useEffect(() => {
    if (departments.length === 0) return;
    const raw = sessionStorage.getItem('razdelka_prefill');
    if (!raw) return;
    sessionStorage.removeItem('razdelka_prefill');
    try {
      const prefill = JSON.parse(raw);
      openCreateFromPrefill(prefill);
    } catch {
      // ignore invalid prefill
    }
  }, [departments]);

  useEffect(() => {
    if (!modal) return;
    if (!form.from_department_id) {
      setInputProducts([]);
      return;
    }
    api.getProducts({ department_id: form.from_department_id })
      .then(setInputProducts)
      .catch(console.error);
  }, [modal, form.from_department_id, branchId]);

  const departmentCatalog = useMemo(() => {
    if (!form.from_department_id) return [];
    return inputProducts;
  }, [form.from_department_id, inputProducts]);

  const resolveRowProduct = useCallback((item) => {
    if (!item?.product_id || !departmentCatalog.length) return null;
    const { product, variant } = resolvePickFromProducts(
      departmentCatalog,
      encodeProductPick(item.product_id, item.variant_id),
    );
    if (!product) return null;
    return {
      ...product,
      name: getPickDisplayName(product, variant),
      stock: getPickStock(product, variant),
      price: getPickPrice(product, variant),
    };
  }, [departmentCatalog]);

  useEffect(() => {
    if (!selectedCalcId) {
      setActiveCalc(null);
      return;
    }
    api.getCalculation(selectedCalcId).then(setActiveCalc).catch(console.error);
  }, [selectedCalcId]);

  const outputColumns = activeCalc?.items || [];

  useEffect(() => {
    if (!activeCalc?.items?.length) return;
    setForm((prev) => ({
      ...prev,
      input_items: prev.input_items.map((row) => initRowOutputs(row, activeCalc.items)),
    }));
  }, [activeCalc?.id]);

  const openCreateFromPrefill = (prefill) => {
    const defaultFrom = branchDepartments.find((d) => d.id === 'main_wh')?.id
      || branchDepartments[0]?.id
      || '';
    const defaultTo = branchDepartments.find((d) => d.id === 'main_wh')?.id
      || branchDepartments[0]?.id
      || '';
    setForm({
      ...emptyForm,
      from_department_id: defaultFrom,
      to_department_id: defaultTo,
      comment: prefill.calculation_name ? `По калькуляции: ${prefill.calculation_name}` : '',
      input_items: [initRowOutputs({
        product_id: prefill.input_items?.[0]?.product_id || prefill.source_product_id || '',
        variant_id: prefill.input_items?.[0]?.variant_id || prefill.source_variant_id || null,
        quantity: prefill.input_quantity || prefill.input_items?.[0]?.quantity || 1,
        price: prefill.input_price || prefill.input_items?.[0]?.price || 0,
        outputs: (prefill.output_items || []).reduce((acc, o) => {
          acc[encodeProductPick(o.product_id, o.variant_id)] = o.quantity || 0;
          return acc;
        }, {}),
      }, prefill.output_items || [])],
    });
    setSelectedCalcId(prefill.calculation_id || '');
    setModal('create');
  };

  const openCreate = () => {
    const defaultFrom = branchDepartments.find((d) => d.id === 'main_wh')?.id
      || branchDepartments[0]?.id
      || '';
    const defaultTo = branchDepartments.find((d) => d.id === 'main_wh')?.id
      || branchDepartments[0]?.id
      || '';
    setForm({
      ...emptyForm,
      from_department_id: defaultFrom,
      to_department_id: defaultTo,
      input_items: [{ ...emptyLine }],
    });
    setSelectedCalcId('');
    setActiveCalc(null);
    setModal('create');
  };

  const applyCalculation = async () => {
    if (!selectedCalcId) {
      show('Выберите калькуляцию', 'error');
      return;
    }
    const input = form.input_items[0];
    const product = resolveRowProduct(input);
    if (!input?.product_id || product?.stock == null) {
      show('Укажите сырьё с остатком в отделе', 'error');
      return;
    }
    try {
      const result = await api.applyCalculation(selectedCalcId, {
        input_quantity: product.stock,
        input_price: input.price || product?.price || 0,
      });
      const outs = result.output_items || [];
      setForm({
        ...form,
        comment: result.calculation_name ? `По калькуляции: ${result.calculation_name}` : form.comment,
        input_items: [initRowOutputs({
          product_id: result.input_items[0]?.product_id || input.product_id,
          variant_id: result.input_items[0]?.variant_id || input.variant_id || null,
          quantity: product.stock,
          price: result.input_price || input.price,
          outputs: outs.reduce((acc, o) => {
            acc[encodeProductPick(o.product_id, o.variant_id)] = o.quantity || 0;
            return acc;
          }, {}),
        }, outs)],
      });
      show('Заполнено по калькуляции');
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const openEdit = async (id) => {
    const doc = await api.getDocument(id);
    let calc = null;
    if (doc.calculation_id) {
      calc = await api.getCalculation(doc.calculation_id).catch(() => null);
      setActiveCalc(calc);
      setSelectedCalcId(doc.calculation_id);
    }
    setForm({
      ...doc,
      from_department_id: doc.from_department_id || '',
      to_department_id: doc.to_department_id || '',
      input_items: mapDocToInputItems(doc, calc?.items || []),
    });
    setModal(id);
  };

  const openHistory = async (id) => {
    const h = await api.getDocumentHistory(id);
    setHistory(h);
    setHistoryModal(id);
  };

  const updateInputPick = (idx, pickValue) => {
    const resolved = resolvePickFromProducts(departmentCatalog, pickValue);
    const input_items = [...form.input_items];
    input_items[idx] = {
      ...input_items[idx],
      product_id: resolved.productId,
      variant_id: resolved.variantId,
      price: getPickPrice(resolved.product, resolved.variant),
    };
    const match = calculations.find(
      (c) => c.source_product_id === resolved.productId
        || (c.source_product_ids || []).includes(resolved.productId),
    );
    if (match) setSelectedCalcId(match.id);
    input_items[idx] = initRowOutputs(input_items[idx], activeCalc?.items || []);
    setForm({ ...form, input_items });
  };

  const updateInput = (idx, field, value) => {
    const input_items = [...form.input_items];
    input_items[idx] = { ...input_items[idx], [field]: value };
    if (field === 'product_id') {
      const product = inputProducts.find((p) => p.id === value) || products.find((p) => p.id === value);
      if (product) input_items[idx].price = product.price || 0;
      const match = calculations.find(
        (c) => c.source_product_id === value
          || (c.source_product_ids || []).includes(value),
      );
      if (match) setSelectedCalcId(match.id);
      input_items[idx] = initRowOutputs(input_items[idx], activeCalc?.items || []);
    }
    setForm({ ...form, input_items });
  };

  const updateOutputWeight = (idx, lineKey, value) => {
    const input_items = [...form.input_items];
    input_items[idx] = {
      ...input_items[idx],
      outputs: {
        ...input_items[idx].outputs,
        [lineKey]: value,
      },
    };
    setForm({ ...form, input_items });
  };

  const addInput = () => setForm({ ...form, input_items: [...form.input_items, { ...emptyLine }] });

  const removeInput = (idx) => {
    if (form.input_items.length <= 1) return;
    setForm({ ...form, input_items: form.input_items.filter((_, i) => i !== idx) });
  };

  const resolveRowStockDisplay = (item) => {
    if (form.status !== 'draft' || isReadOnly) {
      return {
        value: item.quantity,
        unit: resolveRowProduct(item)?.unit || 'кг',
        title: 'Количество по документу',
      };
    }
    const product = resolveRowProduct(item);
    if (!product) return null;
    return {
      value: product.stock ?? 0,
      unit: product.unit || 'кг',
      title: 'Остаток в отделе-источнике',
    };
  };

  const weightUnit = useMemo(() => {
    const item = form.input_items.find((i) => i.product_id);
    if (!item) return 'кг';
    return resolveRowProduct(item)?.unit || 'кг';
  }, [form.input_items, resolveRowProduct]);

  const weightTotals = useMemo(() => {
    const totals = {};
    outputColumns.forEach((col) => {
      const key = colLineKey(col);
      totals[key] = form.input_items.reduce(
        (s, item) => s + (Number(item.outputs?.[key]) || 0),
        0,
      );
    });
    return totals;
  }, [form.input_items, outputColumns]);

  const resolveInputQuantity = (item) => getProcessedWeight(item, outputColumns);

  const pricing = useMemo(
    () => calcRazdelkaPricing(
      form.input_items,
      resolveRowProduct,
      outputColumns,
      { draft: form.status === 'draft' && !isReadOnly },
    ),
    [form.input_items, resolveRowProduct, outputColumns, form.status, isReadOnly],
  );

  const outputPreview = useMemo(() => outputColumns
    .filter((col) => (weightTotals[colLineKey(col)] || 0) > 0 && !col.is_waste)
    .map((col) => colDisplayName(col)), [outputColumns, weightTotals]);

  const stockWarnings = useMemo(() => {
    if (form.status !== 'draft' || isReadOnly) return [];
    return form.input_items.flatMap((item, idx) => {
      if (!item.product_id) return [];
      const product = resolveRowProduct(item);
      if (!product || product.stock == null) return [];
      const weight = getProcessedWeight(item, outputColumns);
      if (weight <= 0 || weight <= product.stock) return [];
      return [{
        idx,
        name: product.name,
        stock: product.stock,
        weight,
        unit: product.unit || 'кг',
      }];
    });
  }, [form.input_items, resolveRowProduct, form.status, isReadOnly, outputColumns]);

  const blocked = !form.from_department_id || !form.to_department_id || !selectedCalcId;
  const hasStockOverflow = stockWarnings.length > 0;

  const save = async (confirm = false) => {
    if (isReadOnly) return;
    try {
      if (!form.from_department_id) {
        show('Выберите отдел-источник', 'error');
        return;
      }
      if (!form.to_department_id) {
        show('Выберите отдел, куда попадёт продукция', 'error');
        return;
      }
      if (!selectedCalcId) {
        show('Выберите калькуляцию', 'error');
        return;
      }
      const input_items = form.input_items.filter((i) => i.product_id);
      if (input_items.length === 0) {
        show('Добавьте сырьё', 'error');
        return;
      }

      const hasWeights = input_items.some((i) => getProcessedWeight(i, outputColumns) > 0);
      const hasSellable = outputColumns.some(
        (col) => !col.is_waste && input_items.some((i) => (Number(i.outputs?.[colLineKey(col)]) || 0) > 0),
      );
      if (!hasWeights || !hasSellable) {
        show('Укажите количество по позициям калькуляции', 'error');
        return;
      }

      if (hasStockOverflow) {
        const w = stockWarnings[0];
        show(`Недостаточно «${w.name}»: указано ${w.weight} ${w.unit}, в отделе ${w.stock} ${w.unit}`, 'error');
        return;
      }

      const data = {
        type: 'razdelka',
        calculation_id: selectedCalcId,
        from_department_id: form.from_department_id,
        to_department_id: form.to_department_id,
        date: form.date,
        comment: form.comment || '',
        status: confirm ? 'confirmed' : form.status,
        input_items: input_items.map((i) => {
          const { product, variant } = resolvePickFromProducts(
            products,
            encodeProductPick(i.product_id, i.variant_id),
          );
          return {
            product_id: i.product_id,
            variant_id: i.variant_id || null,
            quantity: resolveInputQuantity(i),
            price: i.price || getPickPrice(product, variant) || 0,
            outputs: i.outputs || {},
          };
        }),
      };

      if (modal === 'create') {
        await api.createDocument(data);
        show(confirm ? 'Разделка проведена' : 'Документ создан');
      } else {
        await api.updateDocument(modal, data);
        show(confirm ? 'Разделка проведена' : 'Документ обновлён');
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
      show('Разделка проведена');
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

  const removeDoc = async (doc) => {
    if (!window.confirm(`Удалить разделку №${doc.number}?`)) return;
    try {
      await api.deleteDocument(doc.id);
      show(`Документ №${doc.number} удалён`);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const deptLabel = (d) => {
    const from = d.from_department_name || '—';
    const to = d.to_department_name || '—';
    return `${from} → ${to}`;
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Разделка</h1>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>+ Новая разделка</button>
        )}
      </div>

      <div className="filters">
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
                <th>Номер</th>
                <th>Дата</th>
                <th>Маршрут</th>
                <th>Сумма выхода</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.number}</td>
                  <td>{formatDate(d.date)}</td>
                  <td>{deptLabel(d)}</td>
                  <td>{formatMoney(d.total_amount)}</td>
                  <td><span className={`badge badge-${d.status}`}>{STATUS_LABELS[d.status]}</span></td>
                  <td>
                    <div className="btn-group btn-group-icons">
                      <IconButton title="Открыть" onClick={() => openEdit(d.id)}>
                        <IconEye />
                      </IconButton>
                      {canConfirm && d.status === 'draft' && (
                        <IconButton title="Провести" onClick={() => confirmDoc(d.id)}>
                          <IconCheck />
                        </IconButton>
                      )}
                      {canEdit && d.status !== 'cancelled' && (
                        <IconButton title="Отменить" onClick={() => cancelDoc(d.id)}>
                          <IconUndo />
                        </IconButton>
                      )}
                      <IconButton title="История" onClick={() => openHistory(d.id)}>
                        <IconHistory />
                      </IconButton>
                      {canDelete && (
                        <IconButton title="Удалить" onClick={() => removeDoc(d)}>
                          <IconTrash />
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr><td colSpan={6} className="empty">Нет документов разделки</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          className="modal-doc"
          title={modal === 'create' ? 'Новая разделка' : (isReadOnly ? 'Просмотр разделки' : 'Редактирование разделки')}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Закрыть</button>
              {canEdit && form.status !== 'cancelled' && (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => save(false)} disabled={hasStockOverflow}>Сохранить</button>
                  {form.status === 'draft' && canConfirm && (
                    <button type="button" className="btn btn-success" onClick={() => save(true)} disabled={hasStockOverflow}>Провести</button>
                  )}
                </>
              )}
            </>
          }
        >
          <div className="doc-modal">
            <div className="doc-modal-fields">
              {!form.from_department_id && !isReadOnly && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Выберите отдел, откуда берётся сырьё (например, Склад после прихода).
                </div>
              )}
              {!form.to_department_id && !isReadOnly && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Выберите отдел, куда попадёт готовая продукция (обычно Склад).
                </div>
              )}
              <div className="form-grid">
                {calculations.length > 0 && form.status === 'draft' && !isReadOnly && (
                  <div className="form-group full calc-razdelka-row">
                    <label>Калькуляция</label>
                    <div className="calc-razdelka-controls">
                      <select
                        value={selectedCalcId}
                        onChange={(e) => setSelectedCalcId(e.target.value)}
                      >
                        <option value="">— без шаблона —</option>
                        {calculations.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!selectedCalcId}
                        onClick={applyCalculation}
                      >
                        Заполнить по калькуляции
                      </button>
                    </div>
                  </div>
                )}
                <div className="form-group">
                  <label>Дата</label>
                  <input type="date" value={form.date} disabled={isReadOnly || form.status !== 'draft'} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Откуда (сырьё) *</label>
                  <select
                    value={form.from_department_id || ''}
                    disabled={isReadOnly || form.status !== 'draft'}
                    onChange={(e) => setForm({ ...form, from_department_id: e.target.value, input_items: [{ ...emptyLine }] })}
                  >
                    <option value="">— выберите —</option>
                    {branchDepartments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Куда (склад) *</label>
                  <select
                    value={form.to_department_id || ''}
                    disabled={isReadOnly || form.status !== 'draft'}
                    onChange={(e) => setForm({ ...form, to_department_id: e.target.value })}
                  >
                    <option value="">— выберите —</option>
                    {branchDepartments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Статус</label>
                  <input value={STATUS_LABELS[form.status] || form.status} disabled />
                </div>
                <div className="form-group full">
                  <label>Комментарий</label>
                  <textarea rows={2} value={form.comment || ''} disabled={isReadOnly || form.status !== 'draft'} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="doc-modal-items razdelka-items-panel">
              <div className="doc-modal-items-header doc-modal-items-header-split">
                <h3>Сырьё (вход)</h3>
                {canEdit && form.status === 'draft' && (
                  <AddRowButton onClick={addInput} disabled={blocked} />
                )}
              </div>
              {!selectedCalcId && !isReadOnly && form.status === 'draft' && (
                <div className="alert alert-error" style={{ marginBottom: 12 }}>
                  Выберите калькуляцию — по ней будут показаны выходные товары.
                </div>
              )}
              {hasStockOverflow && (
                <div className="alert alert-error razdelka-stock-alert">
                  {stockWarnings.map((w) => (
                    <div key={w.idx}>
                      Недостаточно «{w.name}»: сумма по калькуляции {w.weight} {w.unit}, в отделе только {w.stock} {w.unit}
                    </div>
                  ))}
                </div>
              )}
              <div className="table-wrap items-table doc-items-table doc-modal-items-scroll razdelka-section">
                <table>
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Остаток</th>
                      {outputColumns.map((col) => (
                        <th key={colLineKey(col)} title={col.is_waste ? 'Без стоимости' : undefined}>
                          {colDisplayName(col)}
                          {col.is_waste ? ' (отход)' : ''}
                        </th>
                      ))}
                      {!outputColumns.length && (
                        <>
                          <th>Выход</th>
                        </>
                      )}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.input_items.map((item, idx) => {
                      const stockDisplay = resolveRowStockDisplay(item);
                      const rowWarning = stockWarnings.find((w) => w.idx === idx);
                      const processedWeight = getProcessedWeight(item);
                      return (
                      <tr key={`in-${idx}`} className={rowWarning ? 'razdelka-row-overstock' : undefined}>
                        <td>
                          <ProductSelect
                            products={departmentCatalog}
                            allProducts={departmentCatalog}
                            value={encodeProductPick(item.product_id, item.variant_id)}
                            onChange={(pickValue) => updateInputPick(idx, pickValue)}
                            disabled={blocked || isReadOnly || form.status !== 'draft' || !form.from_department_id}
                            placeholder={form.from_department_id ? 'Выберите сырьё...' : 'Сначала выберите отдел-источник'}
                          />
                        </td>
                        <td>
                          <div className="razdelka-qty-cell">
                            {stockDisplay ? (
                              <span className={`razdelka-qty-stock${rowWarning ? ' razdelka-qty-stock-over' : ''}`} title={stockDisplay.title}>
                                <strong>{stockDisplay.value}</strong> {stockDisplay.unit}
                              </span>
                            ) : (
                              <span className="razdelka-qty-stock razdelka-qty-stock-empty">—</span>
                            )}
                            {rowWarning && (
                              <span className="razdelka-stock-row-warning">
                                указано {processedWeight} {rowWarning.unit}
                              </span>
                            )}
                          </div>
                        </td>
                        {outputColumns.map((col) => {
                          const lineKey = colLineKey(col);
                          return (
                          <td key={`${idx}-${lineKey}`}>
                            <div className="razdelka-weight-cell">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.outputs?.[lineKey] || ''}
                                placeholder="0"
                                disabled={isReadOnly || form.status !== 'draft' || blocked}
                                onChange={(e) => updateOutputWeight(idx, lineKey, +e.target.value)}
                              />
                              {!col.is_waste && pricing.sellableWeight > 0 && (item.outputs?.[lineKey] || 0) > 0 && (
                                <span className="razdelka-weight-amount">
                                  {formatMoney((Number(item.outputs?.[lineKey]) || 0) * pricing.unitPrice)}
                                </span>
                              )}
                              {col.is_waste && (item.outputs?.[lineKey] || 0) > 0 && (
                                <span className="razdelka-weight-amount razdelka-weight-amount-zero">0 сум</span>
                              )}
                            </div>
                          </td>
                          );
                        })}
                        {!outputColumns.length && (
                          <td className="empty">Выберите калькуляцию</td>
                        )}
                        <td>
                          {canEdit && form.status === 'draft' && form.input_items.length > 1 && (
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => removeInput(idx)}>×</button>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="doc-items-total">
                {outputPreview.length > 0 && (
                  <>
                    На складе: {outputPreview.join(', ')}
                    {' · '}
                  </>
                )}
                {pricing.inputTotal > 0 && (
                  <>
                    Сырьё: {formatMoney(pricing.inputTotal)}
                    {' · '}
                  </>
                )}
                {outputColumns.map((col, idx) => {
                  const lineKey = colLineKey(col);
                  return (
                  <span key={lineKey}>
                    {idx > 0 ? ' · ' : ''}
                    {colDisplayName(col)}: {weightTotals[lineKey] || 0} {col.unit || weightUnit}
                    {!col.is_waste && pricing.outputAmounts[lineKey] > 0
                      && ` (${formatMoney(pricing.outputAmounts[lineKey])})`}
                    {col.is_waste && (weightTotals[lineKey] || 0) > 0 && ' (0 сум)'}
                  </span>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {historyModal && (
        <Modal title="История изменений" onClose={() => setHistoryModal(null)} footer={<button type="button" className="btn btn-ghost" onClick={() => setHistoryModal(null)}>Закрыть</button>}>
          {history.map((h) => (
            <div key={h.id} className="history-item">
              <strong>{ACTION_LABELS?.[h.action] || h.action}</strong>
              <span>{new Date(h.created_at).toLocaleString('ru-RU')}</span>
              {h.user_name && <span> — {h.user_name}</span>}
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
